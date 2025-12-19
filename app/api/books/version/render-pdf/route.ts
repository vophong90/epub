// app/api/books/version/render-pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRouteClient } from "@/lib/supabaseServer";
import { getAdminClient } from "@/lib/supabase-admin";

import chromium from "@sparticuz/chromium";
import { chromium as pwChromium } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET_PREVIEW = "pdf_previews";
const SIGNED_EXPIRES_SEC = 60 * 10;

type Body = { version_id?: string; template_id?: string };

function esc(s: string) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

// TODO: anh thay phần này bằng query thật từ bảng nội dung của anh
async function buildChaptersHTML(_admin: any, _versionId: string) {
  // return array chapters: { id, title, html }
  // html là nội dung đã convert ra HTML (p, h2/h3, table, figure...)
  return [
    {
      id: "ch1",
      title: "Chương 1. Ví dụ",
      html: `<p>Đây là nội dung mẫu. Anh thay bằng nội dung thực tế lấy từ DB.</p>
             <h2>Mục 1.1</h2><p>...</p>
             <h3>Tiểu mục 1.1.1</h3><p>...</p>`,
    },
  ];
}

export async function POST(req: NextRequest) {
  const supabase = getRouteClient();
  const admin = getAdminClient();

  // auth
  const { data: { user }, error: uErr } = await supabase.auth.getUser();
  if (uErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
  try { body = await req.json(); } catch { body = {}; }
  const versionId = (body.version_id || "").toString();
  const templateId = (body.template_id || "").toString();
  if (!versionId || !templateId) {
    return NextResponse.json({ error: "version_id và template_id là bắt buộc" }, { status: 400 });
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
    return NextResponse.json({ error: "Không tạo được render job", detail: rInsErr?.message }, { status: 500 });
  }

  const renderId = render.id;

  try {
    // build chapters html (TODO: replace by real DB content)
    const chapters = await buildChaptersHTML(admin, versionId);

    // merge template tokens
    const year = new Date().getFullYear().toString();
    const token = (s?: string) =>
      (s || "")
        .replaceAll("{{BOOK_TITLE}}", esc(book.title))
        .replaceAll("{{YEAR}}", esc(year))
        .replaceAll("{{CHAPTER_TITLE}}", ""); // sẽ set theo chương bằng running elements

    const cover = token(tpl.cover_html);
    const front = token(tpl.front_matter_html);
    const toc = token(tpl.toc_html);
    const header = token(tpl.header_html);
    const footer = token(tpl.footer_html);

    // main content + running chapter title
    const main = chapters
      .map((ch) => {
        // mỗi chương: set running header right = tên chương
        return `
<section class="chapter" id="${esc(ch.id)}" data-chapter-title="${esc(ch.title)}">
  <div class="runningHeaderRight" style="position: running(runningHeaderRight);">${esc(ch.title)}</div>
  <h1 class="chapter-title">${esc(ch.title)}</h1>
  ${ch.html}
</section>`;
      })
      .join("\n");

    // build TOC list markup (Paged.js will later annotate page numbers)
    const tocList = chapters
      .map(
        (ch) => `
<li>
  <a href="#${esc(ch.id)}">${esc(ch.title)}</a>
  <span class="dots"></span>
  <span class="page" data-toc-target="#${esc(ch.id)}"></span>
</li>`
      )
      .join("\n");

    // Load pagedjs from node_modules (no CDN)
    // We inline it to guarantee availability in serverless
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
    // Fill TOC list before paginate
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
        // Build map: element id -> page number
        var map = {};
        flow.pages.forEach(function(page, idx){
          // page number in printed doc is idx+1
          var pn = (idx+1).toString();
          var elts = page.element.querySelectorAll("[id]");
          elts.forEach(function(el){
            if (!map[el.id]) map[el.id] = pn;
          });
        });

        // Fill each TOC line
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
    await page.waitForFunction(() => (window as any).__PAGED_DONE__ === true, null, { timeout: 120000 });

    // print to PDF
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: undefined, // dùng @page margin
    });

    await browser.close();

    // upload preview
    const pdf_path = `book/${book.id}/version/${version.id}/render/${renderId}.pdf`;

    const { error: upErr } = await admin.storage
      .from(BUCKET_PREVIEW)
      .upload(pdf_path, pdfBuffer, { contentType: "application/pdf", upsert: true });

    if (upErr) throw new Error("Upload preview PDF failed: " + upErr.message);

    await admin.from("book_renders").update({
      status: "done",
      pdf_path,
      finished_at: new Date().toISOString(),
      error: null,
    }).eq("id", renderId);

    // signed url for preview
    const { data: signed, error: sErr } = await admin.storage
      .from(BUCKET_PREVIEW)
      .createSignedUrl(pdf_path, SIGNED_EXPIRES_SEC);

    if (sErr || !signed?.signedUrl) {
      return NextResponse.json({ ok: true, render_id: renderId, pdf_path });
    }

    return NextResponse.json({ ok: true, render_id: renderId, preview_url: signed.signedUrl });
  } catch (e: any) {
    await admin.from("book_renders").update({
      status: "error",
      error: e?.message || String(e),
      finished_at: new Date().toISOString(),
    }).eq("id", renderId);

    return NextResponse.json({ error: "Render PDF failed", detail: e?.message || String(e), render_id: renderId }, { status: 500 });
  }
}
