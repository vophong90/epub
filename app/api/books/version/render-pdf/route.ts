// app/api/books/version/render-pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRouteClient } from "@/lib/supabaseServer";
import { getAdminClient } from "@/lib/supabase-admin";

import chromium from "@sparticuz/chromium";
import { chromium as pwChromium } from "playwright-core";
import fs from "node:fs/promises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET_PREVIEW = "pdf_previews";
const SIGNED_EXPIRES_SEC = 60 * 10;

type Body = { version_id?: string; template_id?: string };

function esc(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

type TocItemRow = {
  id: string;
  parent_id: string | null;
  title: string;
  slug: string;
  order_index: number;
};

type TocContentRow = {
  toc_item_id: string;
  content_json: any;
  status: string;
};

type RenderNode = {
  id: string;         // anchor id in HTML
  toc_item_id: string;
  title: string;
  slug: string;
  depth: number;      // 1 = chapter
  chapterTitle: string; // nearest depth=1 title
  html: string;       // raw html (already trusted from your editor)
};

function makeAnchor(tocItemId: string, slug: string) {
  // anchor must be stable + safe
  const safeSlug = (slug || "")
    .toLowerCase()
    .replace(/[^a-z0-9\-_.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `toc-${tocItemId}${safeSlug ? "-" + safeSlug : ""}`;
}

/**
 * Build ordered toc tree nodes + attach content_html from toc_contents.content_json.html
 * - depth 1 => chapter
 * - depth 2 => section
 * - depth 3+ => sub-sections
 */
async function buildNodesFromDB(admin: any, versionId: string): Promise<RenderNode[]> {
  // 1) load all toc items
  const { data: items, error: itErr } = await admin
    .from("toc_items")
    .select("id,parent_id,title,slug,order_index")
    .eq("book_version_id", versionId);

  if (itErr) throw new Error("Load toc_items failed: " + itErr.message);
  const tocItems = (items || []) as TocItemRow[];

  // 2) load all contents (1-1 with toc_item_id)
  const { data: contents, error: ctErr } = await admin
    .from("toc_contents")
    .select("toc_item_id,content_json,status")
    .in("toc_item_id", tocItems.map((x) => x.id));

  if (ctErr) throw new Error("Load toc_contents failed: " + ctErr.message);
  const tocContents = (contents || []) as TocContentRow[];

  const contentByItem = new Map<string, TocContentRow>();
  for (const c of tocContents) contentByItem.set(c.toc_item_id, c);

  // OPTIONAL: nếu anh muốn chỉ in content đã approved:
  // (chỉ cần uncomment 2 dòng dưới)
  // const APPROVED_ONLY = true;
  // if (APPROVED_ONLY) { ... filter status ... }

  // 3) build children map and sort by order_index
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
      const isChapter = depth === 1;
      const chapterTitle = isChapter ? it.title : currentChapterTitle;

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
        html: html || "", // empty is allowed
      });

      walk(it.id, depth + 1, chapterTitle);
    }
  }

  walk(null, 1, "");

  return nodes;
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

  // admin only
  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("id,system_role")
    .eq("id", user.id)
    .maybeSingle();

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!profile || profile.system_role !== "admin") {
    return NextResponse.json({ error: "Chỉ admin mới được render PDF" }, { status: 403 });
  }

  // body
  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const versionId = (body.version_id || "").toString();
  const templateId = (body.template_id || "").toString();
  if (!versionId || !templateId) {
    return NextResponse.json(
      { error: "version_id và template_id là bắt buộc" },
      { status: 400 }
    );
  }

  // load version + book
  const { data: version, error: vErr } = await admin
    .from("book_versions")
    .select("id,book_id,version_no")
    .eq("id", versionId)
    .maybeSingle();

  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });
  if (!version) return NextResponse.json({ error: "Không tìm thấy version" }, { status: 404 });

  const { data: book, error: bErr } = await admin
    .from("books")
    .select("id,title,unit_name")
    .eq("id", version.book_id)
    .maybeSingle();

  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });
  if (!book) return NextResponse.json({ error: "Không tìm thấy book" }, { status: 404 });

  // load template
  const { data: tpl, error: tErr } = await admin
    .from("book_templates")
    .select("id,name,css,cover_html,front_matter_html,toc_html,header_html,footer_html,page_size,page_margin_mm")
    .eq("id", templateId)
    .eq("is_active", true)
    .maybeSingle();

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (!tpl) return NextResponse.json({ error: "Không tìm thấy template" }, { status: 404 });

  // create render job
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
    // ✅ Build nodes from your real tables
    const nodes = await buildNodesFromDB(admin, versionId);

    // tokens
    const year = new Date().getFullYear().toString();
    const token = (s?: string) =>
      (s || "")
        .replaceAll("{{BOOK_TITLE}}", esc(book.title))
        .replaceAll("{{YEAR}}", esc(year))
        .replaceAll("{{CHAPTER_TITLE}}", ""); // set by running elements inside main

    const cover = token(tpl.cover_html);
    const front = token(tpl.front_matter_html);
    const toc = token(tpl.toc_html);
    const header = token(tpl.header_html);
    const footer = token(tpl.footer_html);

    // MAIN HTML: depth mapping
    // depth 1 -> h1 + page break (chapter)
    // depth 2 -> h2
    // depth 3+ -> h3 (keep CSS simple)
    const main = nodes
      .map((n) => {
        const isChapter = n.depth === 1;
        const tag = n.depth === 1 ? "h1" : n.depth === 2 ? "h2" : "h3";

        // If chapter: set running header right to chapter title
        const runningChapter = isChapter
          ? `<div class="runningHeaderRight" style="position: running(runningHeaderRight);">${esc(
              n.title
            )}</div>`
          : "";

        const bodyHtml =
          n.html && n.html.trim()
            ? n.html
            : `<p style="color:#777;"><em>(Chưa có nội dung)</em></p>`;

        return `
<section class="${isChapter ? "chapter" : "section"}" id="${esc(n.id)}" data-toc-item="${esc(
          n.toc_item_id
        )}" data-depth="${n.depth}" data-chapter-title="${esc(n.chapterTitle)}">
  ${runningChapter}
  <${tag} class="${isChapter ? "chapter-title" : ""}">${esc(n.title)}</${tag}>
  ${bodyHtml}
</section>`;
      })
      .join("\n");

    // TOC list: indent by depth
    const tocList = nodes
      .map((n) => {
        const pad = Math.max(0, (n.depth - 1) * 14); // px
        return `
<li style="padding-left:${pad}px">
  <a href="#${esc(n.id)}">${esc(n.title)}</a>
  <span class="dots"></span>
  <span class="page" data-toc-target="#${esc(n.id)}"></span>
</li>`;
      })
      .join("\n");

    // Inline paged.js (no CDN)
    const pagedPath = require.resolve("pagedjs/dist/paged.polyfill.js");
    const pagedCode = await fs.readFile(pagedPath, "utf8");

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${esc(book.title)} – v${version.version_no}</title>
  <style>${tpl.css}</style>
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

  <script>${pagedCode}</script>
  <script>
    // After Paged.js paginates, compute page numbers for TOC
    window.PagedConfig = window.PagedConfig || {};
    window.PagedConfig.after = function(flow){
      try{
        var map = {}; // anchor id -> page number
        flow.pages.forEach(function(page, idx){
          var pn = (idx+1).toString();
          // pick anchors on this page
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
      }catch(e){}
      window.__PAGED_DONE__ = true;
    };
  </script>
</body>
</html>`;

    // Launch Chromium (serverless)
    const browser = await pwChromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });

    // wait paginate done
    await page.waitForFunction(
      () => (window as any).__PAGED_DONE__ === true,
      null,
      { timeout: 120000 }
    );

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: undefined, // dùng @page margin trong template
    });

    await browser.close();

    // upload preview
    const pdf_path = `book/${book.id}/version/${version.id}/render/${renderId}.pdf`;

    const { error: upErr } = await admin.storage
      .from(BUCKET_PREVIEW)
      .upload(pdf_path, pdfBuffer, { contentType: "application/pdf", upsert: true });

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
      { error: "Render PDF failed", detail: e?.message || String(e), render_id: renderId },
      { status: 500 }
    );
  }
}
