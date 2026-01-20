// app/api/books/version/render-pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRouteClient } from "@/lib/supabaseServer";
import { getAdminClient } from "@/lib/supabase-admin";

import chromium from "@sparticuz/chromium-min";
import puppeteer from "puppeteer-core";

import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BUCKET_PREVIEW = "pdf_previews";
const SIGNED_EXPIRES_SEC = 60 * 10;

type Body = {
  version_id?: string;
  template_id?: string;
};

function esc(s: string) {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getSiteOrigin(req: NextRequest) {
  const env =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    process.env.VERCEL_URL;

  if (env) {
    if (env.startsWith("http")) return env.replace(/\/+$/, "");
    return `https://${env}`.replace(/\/+$/, "");
  }

  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    new URL(req.url).host;

  return `${proto}://${host}`.replace(/\/+$/, "");
}

function loadCJKFontBase64() {
  try {
    const fontPath = path.join(
      process.cwd(),
      "public",
      "fonts",
      "NotoSerifCJKsc-Regular.otf"
    );
    const buf = fs.readFileSync(fontPath);
    return buf.toString("base64");
  } catch (e) {
    console.error("❌ Load CJK font failed:", e);
    return null;
  }
}

function loadPagedJSInline() {
  const p = path.join(process.cwd(), "public", "paged.polyfill.js");
  try {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, "utf8");
    }
  } catch (e) {
    console.error("❌ Cannot load /public/paged.polyfill.js", e);
  }
  return null;
}

function injectPagedTocCSS(css: string) {
  // ✅ cách ít lỗi hơn leader()
  return `
${css}

/* ===== TOC page numbers (Paged.js) ===== */
nav.toc li a{
  display:flex;
  align-items:baseline;
  gap:8px;
}
nav.toc li a::after{
  content: target-counter(attr(href), page);
  margin-left:auto;
  font-variant-numeric: tabular-nums;
}

/* dotted leader (ổn định hơn leader()) */
nav.toc li a::before{
  content:"";
  flex:1;
  border-bottom: 1px dotted rgba(0,0,0,.35);
  margin: 0 8px;
  transform: translateY(-2px);
}

/* khi pagedjs render pages, tắt column-count để không xung đột pagination */
.pagedjs_pages #book-content{
  column-count: auto !important;
  -webkit-column-count: auto !important;
}
`;
}

/** DB row types tối giản */
type TocItemRow = {
  id: string;
  parent_id: string | null;
  title: string;
  slug: string;
  order_index: number;
  kind: "section" | "chapter" | "heading" | null;
};

type TocContentRow = {
  toc_item_id: string;
  content_json: any;
  status: string;
};

type RenderNode = {
  id: string;
  toc_item_id: string;
  title: string;
  slug: string;
  kind: "section" | "chapter" | "heading";
  depth: number;
  chapterTitle: string;
  html: string;
};

type VersionRow = {
  id: string;
  book_id: string;
  version_no: number | string;
  template_id: string | null;
};

type TemplateRow = {
  id: string;
  name: string | null;
  css: string | null;
  cover_html: string | null;
  front_matter_html: string | null;
  toc_html: string | null;
  header_html: string | null;
  footer_html: string | null;
  page_size: string | null;
  page_margin_mm: any;
  toc_depth: number | null;
};

function makeAnchor(tocItemId: string, slug: string) {
  const safeSlug = (slug || "")
    .toLowerCase()
    .replace(/[^a-z0-9\-_.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `toc-${tocItemId}${safeSlug ? "-" + safeSlug : ""}`;
}

/* =========================
 * Pagination helpers
 * ========================= */

async function fetchAllTocItemsByVersion(admin: any, versionId: string): Promise<TocItemRow[]> {
  const PAGE = 1000;
  let from = 0;
  const all: TocItemRow[] = [];

  while (true) {
    const { data, error } = await admin
      .from("toc_items")
      .select("id,parent_id,title,slug,order_index,kind")
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

async function fetchAllTocContentsByItemIds(admin: any, tocItemIds: string[]): Promise<TocContentRow[]> {
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

async function buildNodesFromDB(admin: any, versionId: string): Promise<RenderNode[]> {
  const tocItems = await fetchAllTocItemsByVersion(admin, versionId);
  if (!tocItems.length) return [];

  const tocContents = await fetchAllTocContentsByItemIds(admin, tocItems.map((x) => x.id));

  const contentByItem = new Map<string, TocContentRow>();
  for (const c of tocContents) contentByItem.set(c.toc_item_id, c);

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

  const nodes: RenderNode[] = [];

  function walk(parentId: string | null, depth: number, currentChapterTitle: string) {
    const kids = children.get(parentId) || [];
    for (const it of kids) {
      const anchor = makeAnchor(it.id, it.slug);

      const c = contentByItem.get(it.id);
      const cj = c?.content_json || {};
      const html = typeof cj?.html === "string" ? cj.html : "";

      const kind =
        it.kind === "section" || it.kind === "chapter" || it.kind === "heading"
          ? it.kind
          : depth === 1
          ? "chapter"
          : "heading";

      const chapterTitle =
        kind === "chapter" ? it.title : kind === "section" ? "" : currentChapterTitle;

      nodes.push({
        id: anchor,
        toc_item_id: it.id,
        title: it.title,
        slug: it.slug,
        kind,
        depth,
        chapterTitle,
        html: html || "",
      });

      walk(it.id, depth + 1, chapterTitle);
    }
  }

  walk(null, 1, "");
  console.log("[render-pdf] nodes count:", nodes.length);
  return nodes;
}

async function launchBrowser() {
  const executablePath = await chromium.executablePath(
    "https://github.com/Sparticuz/chromium/releases/download/v141.0.0/chromium-v141.0.0-pack.x64.tar"
  );

  const browser = await puppeteer.launch({
    args: [
      ...chromium.args,
      "--disable-features=LazyImageLoading,LazyFrameLoading",
    ],
    executablePath,
    headless: true,
  });

  return browser;
}

export async function POST(req: NextRequest) {
  const supabase = getRouteClient();
  const admin = getAdminClient();

  const { data: { user }, error: uErr } = await supabase.auth.getUser();
  if (uErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body = {};
  try { body = await req.json(); } catch { body = {}; }

  const versionId = (body.version_id || "").toString().trim();
  if (!versionId) return NextResponse.json({ error: "version_id là bắt buộc" }, { status: 400 });

  const { data: version, error: vErr } = await admin
    .from("book_versions")
    .select("id,book_id,version_no,template_id")
    .eq("id", versionId)
    .maybeSingle<VersionRow>();

  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });
  if (!version) return NextResponse.json({ error: "Không tìm thấy version" }, { status: 404 });

  let templateId = (body.template_id || "").toString().trim();
  if (!templateId) templateId = version.template_id || "";
  if (!templateId) return NextResponse.json({ error: "Chưa xác định được template cho phiên bản này" }, { status: 400 });

  // quyền
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

    if (permErr) return NextResponse.json({ error: permErr.message }, { status: 500 });
    canRender = !!perm;
  }

  if (!canRender) return NextResponse.json({ error: "Bạn không có quyền render PDF" }, { status: 403 });

  const { data: book, error: bErr } = await admin
    .from("books")
    .select("id,title,unit_name")
    .eq("id", version.book_id)
    .maybeSingle();

  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });
  if (!book) return NextResponse.json({ error: "Không tìm thấy book" }, { status: 404 });

  const { data: tpl, error: tErr } = await admin
    .from("book_templates")
    .select("id,name,css,cover_html,front_matter_html,toc_html,header_html,footer_html,page_size,page_margin_mm,toc_depth")
    .eq("id", templateId)
    .eq("is_active", true)
    .maybeSingle<TemplateRow>();

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (!tpl) return NextResponse.json({ error: "Không tìm thấy template" }, { status: 404 });

  const tocDepth = Number.isFinite(Number(tpl.toc_depth))
    ? Math.min(6, Math.max(1, Number(tpl.toc_depth)))
    : 1;

  // render job
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
    const origin = getSiteOrigin(req);

    // ✅ load Paged.js bundle (inline)
    const pagedInline = loadPagedJSInline();
    if (!pagedInline) {
      throw new Error("Paged.js not found in node_modules. Ensure dependency `pagedjs` is installed.");
    }

    const nodes = await buildNodesFromDB(admin, versionId);

    const year = new Date().getFullYear().toString();
    const token = (s?: string) =>
      (s || "")
        .replaceAll("{{BOOK_TITLE}}", esc(book.title))
        .replaceAll("{{YEAR}}", esc(year))
        .replaceAll("{{CHAPTER_TITLE}}", "");

    const cover = token(tpl.cover_html || "");
    const front = token(tpl.front_matter_html || "");
    const toc = token(tpl.toc_html || "");
    const header = token(tpl.header_html || "");
    const footer = token(tpl.footer_html || "");

    // css: absolute fonts + inject TOC page num css
    const cssAbs = (tpl.css || "")
      .replaceAll('url("/fonts/', `url("${origin}/fonts/`)
      .replaceAll("url('/fonts/", `url("${origin}/fonts/`)
      .replaceAll("url(/fonts/", `url(${origin}/fonts/`);

    const cssFinal = injectPagedTocCSS(cssAbs);

    const cjkBase64 = loadCJKFontBase64();
    const inlineFontCSS = cjkBase64
      ? `
@font-face {
  font-family: "CJK-Fallback";
  src: url(data:font/opentype;base64,${cjkBase64}) format("opentype");
  font-weight: 400;
  font-style: normal;
}
`
      : "";

    const main = nodes
      .map((n) => {
        const isPart = n.kind === "section";
        const isChapter = n.kind === "chapter";

        const tag =
          n.kind === "section"
            ? "h1"
            : isChapter
            ? "h1"
            : n.depth === 2
            ? "h2"
            : "h3";

        const bodyHtml =
          n.html && n.html.trim()
            ? n.html
            : `<p style="color:#777;"><em>(Chưa có nội dung)</em></p>`;

        if (isPart) {
          return `
<section class="part" id="${esc(n.id)}"
  data-toc-item="${esc(n.toc_item_id)}"
  data-kind="section"
  data-depth="${n.depth}"
  data-chapter-title="">
  <h1 class="part-title">${esc(n.title)}</h1>
</section>`;
        }

        return `
<section class="${isChapter ? "chapter" : "heading"}" id="${esc(n.id)}"
  data-toc-item="${esc(n.toc_item_id)}"
  data-kind="${esc(n.kind)}"
  data-depth="${n.depth}"
  data-chapter-title="${esc(n.chapterTitle)}">
  <${tag} class="${isChapter ? "chapter-title" : ""}">${esc(n.title)}</${tag}>
  ${isChapter ? `<div class="chapter-body">${bodyHtml}</div>` : bodyHtml}
</section>`;
      })
      .join("\n");

    // TOC list
    const tocItems: string[] = [];
    let partNo = 0;
    let chapterNo = 0;

    for (const n of nodes) {
      const isPart = n.kind === "section";
      const isChapter = n.kind === "chapter";
      const level = isPart ? 1 : isChapter ? 2 : 999;
      if (level > tocDepth) continue;
      if (!isPart && !isChapter) continue;

      if (isPart) partNo += 1;
      if (isChapter) chapterNo += 1;

      const pad = level === 2 ? 14 : 0;
      const padAttr = pad ? ` style="padding-left:${pad}px"` : "";
      const label = esc(n.title);

      const cls = isPart
        ? "toc-item toc-item--section"
        : "toc-item toc-item--chapter";

      tocItems.push(`
<li class="${cls}"${padAttr}>
  <a href="#${esc(n.id)}">${label}</a>
</li>`);
    }

    const tocList = tocItems.join("\n");

    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<base href="${origin}/" />
<title>${esc(book.title)} – v${version.version_no}</title>
<style>
${inlineFontCSS}
${cssFinal}
</style>
<script>${pagedInline}</script>
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
</body>
</html>`;

    const browser = await launchBrowser();
    const page = await browser.newPage();

    page.on("console", (msg) => console.log("[render-pdf][browser]", msg.type(), msg.text()));
    page.on("pageerror", (err: unknown) => {const msg = err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err); console.log("[render-pdf][pageerror]", msg);});
    page.on("requestfailed", (r) =>console.log("[render-pdf][requestfailed]", r.url(), r.failure()?.errorText));
    page.setDefaultNavigationTimeout(180000);
    page.setDefaultTimeout(180000);

    // Paged.js paginate là “screen”, rồi PDF in ra DOM đã paginate
    await page.emulateMediaType("screen");

    await page.setContent(html, { waitUntil: "load", timeout: 180000 });

    // force eager images
    await page.evaluate(() => {
      document.querySelectorAll("img").forEach((img) => {
        try {
          (img as any).loading = "eager";
          (img as any).decoding = "sync";
          const src = img.getAttribute("src");
          if (src) img.setAttribute("src", src);
        } catch {}
      });
    });

    // wait fonts + images settle BEFORE paginate
    await page.evaluate(() => {
  const links = Array.from(document.querySelectorAll('nav.toc a[href^="#"]')) as HTMLAnchorElement[];
  const missing: string[] = [];
  const ids = new Map<string, number>();

  // check missing targets
  for (const a of links) {
    const href = a.getAttribute("href") || "";
    const id = href.slice(1);
    if (!id) continue;

    const el = document.getElementById(id);
    if (!el) missing.push(id);
  }

  // check duplicate ids in document
  const allWithId = Array.from(document.querySelectorAll("[id]")) as HTMLElement[];
  for (const el of allWithId) {
    const id = el.id;
    ids.set(id, (ids.get(id) || 0) + 1);
  }
  const dup = Array.from(ids.entries()).filter(([, n]) => n > 1).map(([id, n]) => `${id}(${n})`);

  if (missing.length || dup.length) {
    throw new Error(
      "TOC target mismatch. Missing: " +
        missing.slice(0, 20).join(", ") +
        (missing.length > 20 ? ` ... (+${missing.length - 20})` : "") +
        " | Duplicate ids: " +
        dup.slice(0, 20).join(", ") +
        (dup.length > 20 ? ` ... (+${dup.length - 20})` : "")
    );
  }
});

    await page.evaluate(async () => {
      if ((document as any).fonts?.ready) await (document as any).fonts.ready;

      const imgs = Array.from(document.images || []);
      await Promise.all(
        imgs.map(async (img: any) => {
          if (!img) return;
          if (!img.complete) {
            await new Promise<void>((res) => {
              img.addEventListener("load", () => res(), { once: true });
              img.addEventListener("error", () => res(), { once: true });
            });
          }
          if (img.decode) {
            try { await img.decode(); } catch {}
          }
        })
      );
    });

    // ✅ run Paged.js paginate and wait done
  await page.evaluate(async () => {
  const w = window as any;
  if (document.fonts?.ready) await document.fonts.ready;
  if (w.PagedPolyfill?.preview) {
    await w.PagedPolyfill.preview();
    return;
  }
  if (w.Paged?.preview) {
    await w.Paged.preview();
    return;
  }
  throw new Error("Paged.js loaded but no preview() found (PagedPolyfill.preview / Paged.preview).");
});

    await page.waitForFunction(() => (window as any).__PAGED_DONE__ === true, {
      timeout: 180000,
    });

    // extra: ensure pages exist
    await page.waitForSelector(".pagedjs_pages", { timeout: 180000 });

    // Now export PDF from paginated DOM
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: undefined,
    });

    await browser.close();

    const pdf_path = `book/${book.id}/version/${version.id}/render/${renderId}.pdf`;

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
    console.error("[render-pdf] ERROR:", e);

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
        error: "Render PDF failed",
        detail: e?.message || String(e),
        render_id: renderId,
      },
      { status: 500 }
    );
  }
}
