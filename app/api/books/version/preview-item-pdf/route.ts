// app/api/books/version/preview-item-pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRouteClient } from "@/lib/supabaseServer";
import { getAdminClient } from "@/lib/supabase-admin";

import chromium from "@sparticuz/chromium-min";
import puppeteer from "puppeteer-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BUCKET_PREVIEW = "pdf_previews";
const SIGNED_EXPIRES_SEC = 60 * 10;

// Body: preview đúng 1 chương (toc_item)
type Body = { version_id?: string; toc_item_id?: string };

function esc(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getSiteOrigin(req: NextRequest) {
  // ưu tiên env (nếu bạn đã set)
  const env =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    process.env.VERCEL_URL;

  if (env) {
    // VERCEL_URL thường là domain không có https
    if (env.startsWith("http")) return env.replace(/\/+$/, "");
    return `https://${env}`.replace(/\/+$/, "");
  }

  // fallback theo headers proxy
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    new URL(req.url).host;

  return `${proto}://${host}`.replace(/\/+$/, "");
}

/** DB row types tối giản */
type TocItemRow = {
  id: string;
  parent_id: string | null;
  title: string;
  slug: string;
  order_index: number;
  book_version_id?: string;
};

type TocContentRow = {
  toc_item_id: string;
  content_json: any;
  status: string;
};

type RenderNode = {
  id: string; // anchor id
  toc_item_id: string;
  title: string;
  slug: string;
  depth: number; // root preview item => 1
  chapterTitle: string;
  html: string;
};

type VersionRow = {
  id: string;
  book_id: string;
  version_no: number | string;
  template_id: string | null;
};

function makeAnchor(tocItemId: string, slug: string) {
  const safeSlug = (slug || "")
    .toLowerCase()
    .replace(/[^a-z0-9\-_.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `toc-${tocItemId}${safeSlug ? "-" + safeSlug : ""}`;
}

/**
 * =========================
 * Pagination helpers (fix 1000 rows cap)
 * =========================
 */

/** Fetch ALL toc_items for a version using pagination (.range) */
async function fetchAllTocItemsByVersion(
  admin: any,
  versionId: string
): Promise<TocItemRow[]> {
  const PAGE = 1000;
  let from = 0;
  const all: TocItemRow[] = [];

  while (true) {
    const { data, error } = await admin
      .from("toc_items")
      .select("id,parent_id,title,slug,order_index,book_version_id")
      .eq("book_version_id", versionId)
      .order("order_index", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) throw new Error("Load toc_items failed: " + error.message);

    const batch = (data || []) as TocItemRow[];
    all.push(...batch);

    if (batch.length < PAGE) break;
    from += PAGE;
  }

  return all;
}

/**
 * Fetch toc_contents by item ids, in batches + pagination.
 */
async function fetchAllTocContentsByItemIds(
  admin: any,
  tocItemIds: string[]
): Promise<TocContentRow[]> {
  if (!tocItemIds.length) return [];

  const ID_CHUNK = 500;
  const PAGE = 1000;

  const all: TocContentRow[] = [];

  for (let i = 0; i < tocItemIds.length; i += ID_CHUNK) {
    const slice = tocItemIds.slice(i, i + ID_CHUNK);

    let from = 0;
    while (true) {
      const { data, error } = await admin
        .from("toc_contents")
        .select("toc_item_id,content_json,status")
        .in("toc_item_id", slice)
        .order("toc_item_id", { ascending: true })
        .range(from, from + PAGE - 1);

      if (error) throw new Error("Load toc_contents failed: " + error.message);

      const batch = (data || []) as TocContentRow[];
      all.push(...batch);

      if (batch.length < PAGE) break;
      from += PAGE;
    }
  }

  return all;
}

/**
 * ✅ Build nodes CHỈ cho subtree của toc_item_id
 * - depth tính lại từ root => root depth=1
 * - chapterTitle = root.title
 */
async function buildNodesForSubtree(
  admin: any,
  versionId: string,
  rootItemId: string
): Promise<RenderNode[]> {
  const tocItems = await fetchAllTocItemsByVersion(admin, versionId);
  if (!tocItems.length) return [];

  const byId = new Map<string, TocItemRow>();
  for (const it of tocItems) byId.set(it.id, it);

  const root = byId.get(rootItemId);
  if (!root) throw new Error("Không tìm thấy toc_item_id trong version này");

  // children map
  const children = new Map<string | null, TocItemRow[]>();
  for (const it of tocItems) {
    const key = it.parent_id ?? null;
    if (!children.has(key)) children.set(key, []);
    children.get(key)!.push(it);
  }
  for (const [k, arr] of children.entries()) {
    arr.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    children.set(k, arr);
  }

  // collect subtree ids (root + descendants)
  const subtreeIds: string[] = [];
  (function collect(id: string) {
    subtreeIds.push(id);
    const kids = children.get(id) || [];
    for (const k of kids) collect(k.id);
  })(root.id);

  // load contents only for subtree
  const tocContents = await fetchAllTocContentsByItemIds(admin, subtreeIds);

  const contentByItem = new Map<string, TocContentRow>();
  for (const c of tocContents) contentByItem.set(c.toc_item_id, c);

  const nodes: RenderNode[] = [];
  const chapterTitle = root.title;

  function pushNode(it: TocItemRow, depth: number) {
    const anchor = makeAnchor(it.id, it.slug);
    const c = contentByItem.get(it.id);
    const cj = c?.content_json || {};
    const html = typeof cj?.html === "string" ? cj.html : "";

    nodes.push({
      id: anchor,
      toc_item_id: it.id,
      title: it.title,
      slug: it.slug,
      depth,
      chapterTitle,
      html: html || "",
    });
  }

  function walkFrom(parentId: string, depth: number) {
    const kids = children.get(parentId) || [];
    for (const it of kids) {
      // chỉ đi trong subtree (dù kids đã thuộc subtree theo collect)
      pushNode(it, depth);
      walkFrom(it.id, depth + 1);
    }
  }

  // ✅ Root depth=1, children start depth=2
  pushNode(root, 1);
  walkFrom(root.id, 2);

  return nodes;
}

/** Launch browser dùng puppeteer-core + @sparticuz/chromium (serverless-friendly) */
async function launchBrowser() {
  const executablePath = await chromium.executablePath(
    "https://github.com/Sparticuz/chromium/releases/download/v141.0.0/chromium-v141.0.0-pack.x64.tar"
  );

  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath,
  });

  return browser;
}

export async function POST(req: NextRequest) {
  const supabase = getRouteClient();
  const admin = getAdminClient();

  // auth
  const {
    data: { user },
    error: uErr,
  } = await supabase.auth.getUser();

  if (uErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // body
  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const versionId = (body.version_id || "").toString().trim();
  const tocItemId = (body.toc_item_id || "").toString().trim();

  if (!versionId) {
    return NextResponse.json(
      { error: "version_id là bắt buộc" },
      { status: 400 }
    );
  }
  if (!tocItemId) {
    return NextResponse.json(
      { error: "toc_item_id là bắt buộc" },
      { status: 400 }
    );
  }

  // 1) load version + book_id + template_id
  const { data: version, error: vErr } = await admin
    .from("book_versions")
    .select("id,book_id,version_no,template_id")
    .eq("id", versionId)
    .maybeSingle<VersionRow>();

  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });
  if (!version)
    return NextResponse.json({ error: "Không tìm thấy version" }, { status: 404 });
  if (!version.template_id) {
    return NextResponse.json(
      { error: "Phiên bản sách chưa được gán template" },
      { status: 400 }
    );
  }

  const templateId = version.template_id;

  // 2) quyền: admin OR (author/editor trên book)
  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("id,system_role")
    .eq("id", user.id)
    .maybeSingle();

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  const isAdmin = profile?.system_role === "admin";
  let canRender = isAdmin;

  if (!canRender) {
    const { data: perm, error: permErr } = await supabase
      .from("book_permissions")
      .select("role")
      .eq("book_id", version.book_id)
      .eq("user_id", user.id)
      .in("role", ["author", "editor"])
      .maybeSingle();

    if (permErr) {
      return NextResponse.json({ error: permErr.message }, { status: 500 });
    }
    canRender = !!perm;

    // ✅ OPTIONAL: nếu bạn có bảng phân công theo toc_item thì check ở đây
    // Ví dụ:
    // if (perm?.role === "author") {
    //   const { data: asg } = await supabase
    //     .from("toc_assignments")
    //     .select("id")
    //     .eq("toc_item_id", tocItemId)
    //     .eq("user_id", user.id)
    //     .maybeSingle();
    //   if (!asg) canRender = false;
    // }
  }

  if (!canRender) {
    return NextResponse.json(
      { error: "Bạn không có quyền preview PDF" },
      { status: 403 }
    );
  }

  // 3) load book
  const { data: book, error: bErr } = await admin
    .from("books")
    .select("id,title,unit_name")
    .eq("id", version.book_id)
    .maybeSingle();

  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });
  if (!book)
    return NextResponse.json({ error: "Không tìm thấy book" }, { status: 404 });

  // 4) load template
  const { data: tpl, error: tErr } = await admin
    .from("book_templates")
    .select(
      "id,name,css,cover_html,front_matter_html,toc_html,header_html,footer_html,page_size,page_margin_mm"
    )
    .eq("id", templateId)
    .eq("is_active", true)
    .maybeSingle();

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (!tpl)
    return NextResponse.json({ error: "Không tìm thấy template" }, { status: 404 });

  // 5) create render job (log)
  const { data: render, error: rInsErr } = await admin
    .from("book_renders")
    .insert({
      book_id: book.id,
      version_id: version.id,
      template_id: tpl.id,
      status: "rendering",
      created_by: user.id,
    })
    .select("id")
    .maybeSingle();

  if (rInsErr || !render?.id) {
    return NextResponse.json(
      { error: "Không tạo được render job", detail: rInsErr?.message },
      { status: 500 }
    );
  }

  const renderId = render.id;

  try {
    // 1) nodes chỉ subtree của tocItemId
    const nodes = await buildNodesForSubtree(admin, versionId, tocItemId);
    if (!nodes.length) throw new Error("Chương này không có node để render");

    const chapterTitle = nodes[0]?.chapterTitle || nodes[0]?.title || "";

    // 2) Token replace
    const year = new Date().getFullYear().toString();
    const token = (s?: string) =>
      (s || "")
        .replaceAll("{{BOOK_TITLE}}", esc(book.title))
        .replaceAll("{{YEAR}}", esc(year))
        .replaceAll("{{CHAPTER_TITLE}}", esc(chapterTitle || ""));

    const cover = token(tpl.cover_html);
    const front = token(tpl.front_matter_html);
    const toc = token(tpl.toc_html);
    const header = token(tpl.header_html);
    const footer = token(tpl.footer_html);
    const origin = getSiteOrigin(req);
    const cssWithAbsoluteFonts = (tpl.css || "").replaceAll(
      'url("/fonts/',
      `url("${origin}/fonts/`
    );

    // 3) MAIN HTML (chỉ nodes của chương)
    const main = nodes
      .map((n) => {
        const isRoot = n.depth === 1;
        const tag = n.depth === 1 ? "h1" : n.depth === 2 ? "h2" : "h3";

        const runningChapter = isRoot
          ? `<div class="runningHeaderRight" style="position: running(runningHeaderRight);">${esc(
              n.title
            )}</div>`
          : "";

        const bodyHtml =
          n.html && n.html.trim()
            ? n.html
            : `<p style="color:#777;"><em>(Chưa có nội dung)</em></p>`;

        return `
<section class="${isRoot ? "chapter" : "section"}" id="${esc(
          n.id
        )}" data-toc-item="${esc(n.toc_item_id)}" data-depth="${n.depth}" data-chapter-title="${esc(
          n.chapterTitle
        )}">
  ${runningChapter}
  <${tag} class="${isRoot ? "chapter-title" : ""}">${esc(n.title)}</${tag}>
  ${bodyHtml}
</section>`;
      })
      .join("\n");

    // 4) TOC list (chỉ subtree)
    const tocList = nodes
      .map((n) => {
        const pad = Math.max(0, (n.depth - 1) * 14);
        return `
<li style="padding-left:${pad}px">
  <a href="#${esc(n.id)}">${esc(n.title)}</a>
  <span class="dots"></span>
  <span class="page" data-toc-target="#${esc(n.id)}"></span>
</li>`;
      })
      .join("\n");

    // 5) HTML tổng
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${esc(book.title)} – v${version.version_no} – Preview</title>
  <style>${cssWithAbsoluteFonts}</style>
</head>
<body>
  ${cover || ""}
  ${front || ""}
  ${header || ""}
  ${footer || ""}

  ${toc || ""}
  <script>
    (function(){
      var ol = document.getElementById("toc-list");
      if (ol) ol.innerHTML = ${JSON.stringify(tocList)};
    })();
  </script>

  <main id="book-content">
    ${main}
  </main>

  <script>
    window.PagedConfig = window.PagedConfig || {};
    window.PagedConfig.after = function(flow){
      try{
        var map = {};
        flow.pages.forEach(function(page, idx){
          var pn = (idx + 1).toString();
          var elts = page.element.querySelectorAll("[id]");
          elts.forEach(function(el){
            if (!map[el.id]) map[el.id] = pn;
          });
        });

        document.querySelectorAll("[data-toc-target]").forEach(function(span){
          var sel = span.getAttribute("data-toc-target") || "";
          if (!sel.startsWith("#")) return;
          var id = sel.slice(1);
          span.setAttribute("data-page-number", map[id] || "");
          span.textContent = map[id] || "";
        });
      } catch(e){}
      window.__PAGED_DONE__ = true;
    };
  </script>

  <script src="https://unpkg.com/pagedjs/dist/paged.polyfill.js"></script>
</body>
</html>`;

    // 6) Launch Chromium
    const browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 30000 });

    // chờ Paged.js paginate xong
    await page.waitForFunction(() => (window as any).__PAGED_DONE__ === true, {
      timeout: 120000,
    });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: undefined,
    });

    await browser.close();

    // 7) Upload preview (path theo tocItem để không đè)
    const pdf_path = `item/${book.id}/version/${version.id}/toc/${tocItemId}/render/${renderId}.pdf`;

    const { error: upErr } = await admin.storage
      .from(BUCKET_PREVIEW)
      .upload(pdf_path, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (upErr) throw new Error("Upload preview PDF failed: " + upErr.message);

    await admin
      .from("book_renders")
      .update({
        status: "done",
        pdf_path,
        finished_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", renderId);

    const { data: signed, error: sErr } = await admin.storage
      .from(BUCKET_PREVIEW)
      .createSignedUrl(pdf_path, SIGNED_EXPIRES_SEC);

    if (sErr || !signed?.signedUrl) {
      return NextResponse.json({ ok: true, render_id: renderId, pdf_path });
    }

    return NextResponse.json({
      ok: true,
      render_id: renderId,
      preview_url: signed.signedUrl,
    });
  } catch (e: any) {
    await admin
      .from("book_renders")
      .update({
        status: "error",
        error: e?.message || String(e),
        finished_at: new Date().toISOString(),
      })
      .eq("id", renderId);

    return NextResponse.json(
      {
        error: "Preview item PDF failed",
        detail: e?.message || String(e),
        render_id: renderId,
      },
      { status: 500 }
    );
  }
}
