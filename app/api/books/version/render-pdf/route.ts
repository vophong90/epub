// app/api/books/version/render-pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRouteClient } from "@/lib/supabaseServer";
import { getAdminClient } from "@/lib/supabase-admin";

import puppeteer, { type Browser } from "puppeteer-core";
import chromium from "@sparticuz/chromium-min";

import fs from "fs";
import path from "path";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

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

/** DB row types */
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
  id: string; // anchor id in HTML
  toc_item_id: string;
  title: string;
  slug: string;
  kind: "section" | "chapter" | "heading";
  depth: number;
  chapterTitle: string; // running header right
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

function makeAnchor(tocItemId: string) {
  return `toc-${tocItemId}`;
}

/* =========================
 * Supabase range paging
 * ========================= */
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

async function buildNodesFromDB(
  admin: any,
  versionId: string
): Promise<RenderNode[]> {
  const tocItems = await fetchAllTocItemsByVersion(admin, versionId);
  if (!tocItems.length) return [];

  const tocContents = await fetchAllTocContentsByItemIds(
    admin,
    tocItems.map((x) => x.id)
  );

  const contentByItem = new Map<string, TocContentRow>();
  for (const c of tocContents) contentByItem.set(c.toc_item_id, c);

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

  const nodes: RenderNode[] = [];

  function walk(
    parentId: string | null,
    depth: number,
    currentChapterTitle: string
  ) {
    const kids = children.get(parentId) || [];
    for (const it of kids) {
      const anchor = makeAnchor(it.id);

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
        kind === "chapter"
          ? it.title
          : kind === "section"
          ? ""
          : currentChapterTitle;

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
      "--font-render-hinting=none",
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
    executablePath,
    headless: true,
  });

  return browser;
}

function absolutizeFontUrls(css: string, origin: string) {
  return (css || "")
    .replaceAll('url("/fonts/', `url("${origin}/fonts/`)
    .replaceAll("url('/fonts/", `url("${origin}/fonts/`)
    .replaceAll("url(/fonts/", `url(${origin}/fonts/`);
}

/**
 * Render a full HTML document to PDF buffer
 * Fix timeout: avoid networkidle0 + block external requests that can hang.
 */
async function renderHtmlToPdf(browser: Browser, html: string, origin: string) {
  const page = await browser.newPage();

  page.setDefaultNavigationTimeout(180000);
  page.setDefaultTimeout(180000);

  // print css
  await page.emulateMediaType("print");

  // Block external requests that may hang (remote fonts, analytics, etc.)
  const originHost = (() => {
    try {
      return new URL(origin).host;
    } catch {
      return "";
    }
  })();

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();

    // Always allow data/blob
    if (url.startsWith("data:") || url.startsWith("blob:")) return req.continue();

    // Allow same-origin http(s)
    if (url.startsWith("http://") || url.startsWith("https://")) {
      try {
        const u = new URL(url);
        if (originHost && u.host === originHost) return req.continue();
        // block all cross-origin to avoid "networkidle0 never happens"
        return req.abort();
      } catch {
        return req.abort();
      }
    }

    // Allow everything else (about:, file:, etc.)
    return req.continue();
  });

  // Load html: DO NOT use networkidle0 (easy to hang)
  await page.setContent(html, {
    waitUntil: ["domcontentloaded", "load"],
    timeout: 180000,
  });

  // Soft settle: wait for network to go idle-ish, but don't fail if it doesn't
  try {
    // available in puppeteer >= 13
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    await page.waitForNetworkIdle({ idleTime: 800, timeout: 25000 });
  } catch {
    // ignore
  }

  // small extra delay for layout/fonts
  await new Promise((r) => setTimeout(r, 300));

  const buf = await page.pdf({
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
  });

  await page.close();
  return Buffer.from(buf);
}

async function countPdfPages(pdfBuffer: Buffer) {
  const doc = await PDFDocument.load(pdfBuffer);
  return doc.getPageCount();
}

/**
 * Extract chapter anchors from content.pdf by scanning text.
 * Markers are embedded as tiny text:
 *   __ANCHOR__toc-<uuid>__
 */
async function extractAnchorPagesFromPdf(contentPdf: Buffer) {
  const loadingTask = (pdfjsLib as any).getDocument({
    data: new Uint8Array(contentPdf),
  });
  const pdf = await loadingTask.promise;

  const map = new Map<string, number>(); // toc_item_id -> pageIndex(0-based in content.pdf)

  const re = /__ANCHOR__toc-([0-9a-fA-F-]{36})__/g;

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const text = (tc.items || [])
      .map((it: any) => (typeof it.str === "string" ? it.str : ""))
      .join(" ");

    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const tocId = m[1].toLowerCase();
      if (!map.has(tocId)) {
        map.set(tocId, p - 1);
      }
    }
  }

  return map;
}

function buildBaseHtmlDoc(params: {
  origin: string;
  title: string;
  cssFinal: string;
  inlineFontCSS: string;
  bodyHtml: string;
}) {
  const { origin, title, cssFinal, inlineFontCSS, bodyHtml } = params;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<base href="${origin}/" />
<title>${esc(title)}</title>
<style>
${inlineFontCSS}
${cssFinal}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/** Build content HTML with invisible anchor marker at the start of each chapter */
function buildContentBody(nodes: RenderNode[]) {
  const out: string[] = [];

  out.push(`
<style>
.__pdf_anchor{
  font-size: 1px;
  color: transparent;
  line-height: 1px;
  height: 0;
  overflow: hidden;
}
</style>
`);

  for (const n of nodes) {
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
      out.push(`
<section class="part" id="${esc(n.id)}"
  data-toc-item="${esc(n.toc_item_id)}"
  data-kind="section"
  data-depth="${n.depth}"
  data-chapter-title="">
  <h1 class="part-title">${esc(n.title)}</h1>
</section>`);
      continue;
    }

    // Insert marker only for CHAPTER nodes
    const marker = isChapter
      ? `<div class="__pdf_anchor">__ANCHOR__${esc(n.id)}__</div>`
      : "";

    out.push(`
<section class="${isChapter ? "chapter" : "heading"}" id="${esc(n.id)}"
  data-toc-item="${esc(n.toc_item_id)}"
  data-kind="${esc(n.kind)}"
  data-depth="${n.depth}"
  data-chapter-title="${esc(n.chapterTitle)}">
  ${marker}
  <${tag} class="${isChapter ? "chapter-title" : ""}">${esc(n.title)}</${tag}>
  ${isChapter ? `<div class="chapter-body">${bodyHtml}</div>` : bodyHtml}
</section>`);
  }

  return out.join("\n");
}

function buildTocBody(params: {
  bookTitle: string;
  entries: Array<{ label: string; pageNo: number; level: number }>;
}) {
  const { bookTitle, entries } = params;

  const rows = entries
    .map((e) => {
      const pad = e.level === 2 ? 18 : 0;
      return `<div class="toc-row" style="padding-left:${pad}px">
  <div class="toc-label">${esc(e.label)}</div>
  <div class="toc-page">${e.pageNo}</div>
</div>`;
    })
    .join("\n");

  return `
<section class="toc2">
  <h1 class="toc2-title">Mục lục</h1>
  <div class="toc2-list">
    ${rows}
  </div>
</section>

<style>
.toc2{ break-after: page; page-break-after: always; margin: 0; }
.toc2-title{
  text-align:center;
  font-weight:800;
  font-size: 14pt;
  margin: 0 0 16px 0;
}
.toc2-row, .toc-row{
  display:flex;
  gap: 12px;
  align-items: baseline;
  margin: 2px 0;
}
.toc-label{ flex: 1; }
.toc-page{ width: 48px; text-align: right; font-variant-numeric: tabular-nums; }
</style>
`;
}

function truncateText(s: string, maxChars: number) {
  const t = (s || "").trim();
  if (t.length <= maxChars) return t;
  return t.slice(0, Math.max(0, maxChars - 1)) + "…";
}

type ChapterRange = {
  from: number; // inclusive 0-based in FINAL pdf
  to: number; // inclusive 0-based
  title: string;
};

async function stampFinalPdf(params: {
  mergedPdf: Buffer;
  coverPages: number;
  bookTitle: string;
  chapterRanges: ChapterRange[];
}) {
  const { mergedPdf, coverPages, bookTitle, chapterRanges } = params;

  const doc = await PDFDocument.load(mergedPdf);
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const fontBold = await doc.embedFont(StandardFonts.TimesRomanBold);

  const pages = doc.getPages();

  function getChapterTitleForPage(pageIndex: number) {
    for (const r of chapterRanges) {
      if (pageIndex >= r.from && pageIndex <= r.to) return r.title;
    }
    return "";
  }

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const { width, height } = page.getSize();

    // No stamping on cover pages
    if (i < coverPages) continue;

    const headerY = height - 28;
    const footerY = 18;

    const leftText = truncateText(bookTitle, 70);
    const rightText = truncateText(getChapterTitleForPage(i), 70);

    page.drawText(leftText, {
      x: 40,
      y: headerY,
      size: 8.5,
      font: font,
      color: rgb(0.27, 0.27, 0.27),
    });

    if (rightText) {
      const textWidth = font.widthOfTextAtSize(rightText, 8.5);
      page.drawText(rightText, {
        x: Math.max(40, width - 40 - textWidth),
        y: headerY,
        size: 8.5,
        font: font,
        color: rgb(0.27, 0.27, 0.27),
      });
    }

    const pageNo = i - coverPages + 1;
    const pageNoStr = String(pageNo);
    const pnWidth = fontBold.widthOfTextAtSize(pageNoStr, 10);

    page.drawText(pageNoStr, {
      x: width / 2 - pnWidth / 2,
      y: footerY,
      size: 10,
      font: fontBold,
      color: rgb(0.1, 0.1, 0.1),
    });
  }

  const out = await doc.save();
  return Buffer.from(out);
}

async function mergePdfs(buffers: Buffer[]) {
  const outDoc = await PDFDocument.create();

  for (const buf of buffers) {
    const src = await PDFDocument.load(buf);
    const copied = await outDoc.copyPages(src, src.getPageIndices());
    for (const p of copied) outDoc.addPage(p);
  }

  const bytes = await outDoc.save();
  return Buffer.from(bytes);
}

/** Build TOC entries only for section/chapter according to toc_depth */
function buildTocEntries(nodes: RenderNode[], tocDepth: number) {
  const entries: Array<{
    toc_item_id: string;
    label: string;
    level: number;
    kind: string;
  }> = [];

  for (const n of nodes) {
    const isPart = n.kind === "section";
    const isChapter = n.kind === "chapter";
    const level = isPart ? 1 : isChapter ? 2 : 999;

    if (level > tocDepth) continue;
    if (!isPart && !isChapter) continue;

    entries.push({
      toc_item_id: n.toc_item_id,
      label: n.title,
      level,
      kind: n.kind,
    });
  }

  return entries;
}

export async function POST(req: NextRequest) {
  const supabase = getRouteClient();
  const admin = getAdminClient();

  const {
    data: { user },
    error: uErr,
  } = await supabase.auth.getUser();

  if (uErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const versionId = (body.version_id || "").toString().trim();
  if (!versionId) {
    return NextResponse.json(
      { error: "version_id là bắt buộc" },
      { status: 400 }
    );
  }

  const { data: version, error: vErr } = await admin
    .from("book_versions")
    .select("id,book_id,version_no,template_id")
    .eq("id", versionId)
    .maybeSingle<VersionRow>();

  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });
  if (!version)
    return NextResponse.json({ error: "Không tìm thấy version" }, { status: 404 });

  let templateId = (body.template_id || "").toString().trim();
  if (!templateId) templateId = version.template_id || "";
  if (!templateId) {
    return NextResponse.json(
      { error: "Chưa xác định được template cho phiên bản này" },
      { status: 400 }
    );
  }

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

    if (permErr)
      return NextResponse.json({ error: permErr.message }, { status: 500 });
    canRender = !!perm;
  }

  if (!canRender) {
    return NextResponse.json(
      { error: "Bạn không có quyền render PDF" },
      { status: 403 }
    );
  }

  const { data: book, error: bErr } = await admin
    .from("books")
    .select("id,title,unit_name")
    .eq("id", version.book_id)
    .maybeSingle();

  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });
  if (!book) return NextResponse.json({ error: "Không tìm thấy book" }, { status: 404 });

  const { data: tpl, error: tErr } = await admin
    .from("book_templates")
    .select(
      "id,name,css,cover_html,front_matter_html,toc_html,header_html,footer_html,page_size,page_margin_mm,toc_depth"
    )
    .eq("id", templateId)
    .eq("is_active", true)
    .maybeSingle<TemplateRow>();

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (!tpl)
    return NextResponse.json({ error: "Không tìm thấy template" }, { status: 404 });

  const tocDepth = Number.isFinite(Number(tpl.toc_depth))
    ? Math.min(6, Math.max(1, Number(tpl.toc_depth)))
    : 2;

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
    const origin = getSiteOrigin(req);

    const year = new Date().getFullYear().toString();
    const token = (s?: string) =>
      (s || "")
        .replaceAll("{{BOOK_TITLE}}", esc(book.title))
        .replaceAll("{{YEAR}}", esc(year))
        .replaceAll("{{CHAPTER_TITLE}}", "")
        .replaceAll("{{SITE_ORIGIN}}", origin);

    const cssAbs = absolutizeFontUrls(tpl.css || "", origin);

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

    const browser = await launchBrowser();

    const nodes = await buildNodesFromDB(admin, versionId);

    // PASS 1: render cover / front / content (no toc yet)
    const coverBody = token(tpl.cover_html || "");
    const frontBody = token(tpl.front_matter_html || "");
    const contentBody = buildContentBody(nodes);

    const coverHtml = buildBaseHtmlDoc({
      origin,
      title: `${book.title} – cover`,
      cssFinal: cssAbs,
      inlineFontCSS,
      bodyHtml: coverBody || "",
    });

    const frontHtml = buildBaseHtmlDoc({
      origin,
      title: `${book.title} – front`,
      cssFinal: cssAbs,
      inlineFontCSS,
      bodyHtml: frontBody || "",
    });

    const contentHtml = buildBaseHtmlDoc({
      origin,
      title: `${book.title} – content`,
      cssFinal: cssAbs,
      inlineFontCSS,
      bodyHtml: `<main id="book-content">${contentBody}</main>`,
    });

    // ✅ pass origin into renderHtmlToPdf()
    const coverPdf = await renderHtmlToPdf(browser, coverHtml, origin);
    const frontPdf = frontBody
      ? await renderHtmlToPdf(browser, frontHtml, origin)
      : Buffer.from(await (await PDFDocument.create()).save());

    const contentPdf = await renderHtmlToPdf(browser, contentHtml, origin);

    const coverPages = await countPdfPages(coverPdf);
    const frontPages = frontBody ? await countPdfPages(frontPdf) : 0;

    const anchorMap = await extractAnchorPagesFromPdf(contentPdf);
    console.log("[render-pdf] anchors found:", anchorMap.size);

    const chapterNodes = nodes.filter((n) => n.kind === "chapter");

    // PASS 2: iterative TOC render until tocPages stable
    const tocEntriesMeta = buildTocEntries(nodes, tocDepth);

    let tocPdf: Buffer | null = null;
    let tocPagesGuess = 1;

    for (let iter = 0; iter < 5; iter++) {
      const baseOffsetFinal = coverPages + frontPages + tocPagesGuess;

      const entriesWithPage = tocEntriesMeta.map((e) => {
        const uuid = e.toc_item_id.toLowerCase();

        let contentPageIndex: number | null = null;

        if (e.kind === "chapter") {
          contentPageIndex = anchorMap.get(uuid) ?? null;
        } else {
          const idx = nodes.findIndex((n) => n.toc_item_id === e.toc_item_id);
          if (idx >= 0) {
            for (let j = idx + 1; j < nodes.length; j++) {
              const nn = nodes[j];
              if (nn.kind === "section") break;
              if (nn.kind === "chapter") {
                contentPageIndex =
                  anchorMap.get(nn.toc_item_id.toLowerCase()) ?? null;
                break;
              }
            }
          }
        }

        const contentIdx = contentPageIndex ?? 0;

        const finalPageIndex0 = baseOffsetFinal + contentIdx;
        const displayPageNo = finalPageIndex0 - coverPages + 1;

        return {
          label: e.label,
          pageNo: Math.max(1, displayPageNo),
          level: e.level,
        };
      });

      const tocBody = buildTocBody({
        bookTitle: book.title,
        entries: entriesWithPage,
      });

      const tocHtml = buildBaseHtmlDoc({
        origin,
        title: `${book.title} – toc`,
        cssFinal: cssAbs,
        inlineFontCSS,
        bodyHtml: tocBody,
      });

      const tocPdfCandidate = await renderHtmlToPdf(browser, tocHtml, origin);
      const tocPages = await countPdfPages(tocPdfCandidate);

      tocPdf = tocPdfCandidate;

      if (tocPages === tocPagesGuess) {
        console.log("[render-pdf] TOC pages stable:", tocPages);
        break;
      }

      console.log("[render-pdf] TOC pages changed:", tocPagesGuess, "->", tocPages);
      tocPagesGuess = tocPages;
    }

    if (!tocPdf) throw new Error("TOC render failed");

    const tocPagesFinal = await countPdfPages(tocPdf);
    const contentStartFinal0 = coverPages + frontPages + tocPagesFinal;

    const chapterStartsFinal: Array<{ start0: number; title: string }> = [];

    for (const ch of chapterNodes) {
      const uuid = ch.toc_item_id.toLowerCase();
      const contentIdx = anchorMap.get(uuid);
      if (typeof contentIdx !== "number") continue;

      const start0 = contentStartFinal0 + contentIdx;
      chapterStartsFinal.push({ start0, title: ch.title });
    }

    chapterStartsFinal.sort((a, b) => a.start0 - b.start0);

    const mergedBeforeStamp = await mergePdfs([
      coverPdf,
      ...(frontPages ? [frontPdf] : []),
      tocPdf,
      contentPdf,
    ]);

    const totalPages = await countPdfPages(mergedBeforeStamp);

    const chapterRanges: ChapterRange[] = [];
    for (let i = 0; i < chapterStartsFinal.length; i++) {
      const cur = chapterStartsFinal[i];
      const next = chapterStartsFinal[i + 1];
      const from = cur.start0;
      const to = next ? Math.max(from, next.start0 - 1) : totalPages - 1;

      chapterRanges.push({
        from,
        to,
        title: cur.title,
      });
    }

    const finalPdf = await stampFinalPdf({
      mergedPdf: mergedBeforeStamp,
      coverPages,
      bookTitle: book.title,
      chapterRanges,
    });

    await browser.close();

    const pdf_path = `book/${book.id}/version/${version.id}/render/${renderId}.pdf`;

    const { error: upErr } = await admin.storage
      .from(BUCKET_PREVIEW)
      .upload(pdf_path, finalPdf, {
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
      meta: {
        cover_pages: coverPages,
        front_pages: frontPages,
        toc_pages: tocPagesFinal,
        total_pages: totalPages,
      },
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
