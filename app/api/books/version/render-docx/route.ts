// app/api/books/version/render-docx/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRouteClient } from "@/lib/supabaseServer";
import { getAdminClient } from "@/lib/supabase-admin";

import fs from "fs";
import path from "path";

// ❗ Dùng require vì html-to-docx là CommonJS
// (TypeScript vẫn build OK trong môi trường Next Node.js)
const HTMLtoDOCX = require("html-to-docx");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  version_id?: string;
  template_id?: string; // cho phép override khi cần (giống render-pdf)
};

const BUCKET_PREVIEW = "pdf_previews"; // không dùng ở đây, chỉ giữ cho đồng nhất

function esc(s: string) {
  return s
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
    console.error("❌ Load CJK font failed (DOCX):", e);
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
 * Helpers: lấy toàn bộ TOC + content
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
      .select("id,parent_id,title,slug,order_index")
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
        html: html || "",
      });

      walk(it.id, depth + 1, chapterTitle);
    }
  }

  walk(null, 1, "");

  console.log("[render-docx] nodes count:", nodes.length);
  return nodes;
}

/* =========================
 * MAIN HANDLER
 * ========================= */

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

  // Lấy version
  const { data: version, error: vErr } = await admin
    .from("book_versions")
    .select("id,book_id,version_no,template_id")
    .eq("id", versionId)
    .maybeSingle<VersionRow>();

  if (vErr) {
    return NextResponse.json({ error: vErr.message }, { status: 500 });
  }
  if (!version) {
    return NextResponse.json(
      { error: "Không tìm thấy version" },
      { status: 404 }
    );
  }

  // Ưu tiên template_id từ body nếu có
  let templateId = (body.template_id || "").toString().trim();
  if (!templateId) {
    templateId = version.template_id || "";
  }
  if (!templateId) {
    return NextResponse.json(
      { error: "Chưa xác định được template cho phiên bản này" },
      { status: 400 }
    );
  }

  // Quyền: admin hoặc author/editor của book
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
  }

  if (!canRender) {
    return NextResponse.json(
      { error: "Bạn không có quyền xuất DOCX" },
      { status: 403 }
    );
  }

  // Lấy book
  const { data: book, error: bErr } = await admin
    .from("books")
    .select("id,title,unit_name")
    .eq("id", version.book_id)
    .maybeSingle();

  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });
  if (!book)
    return NextResponse.json(
      { error: "Không tìm thấy book" },
      { status: 404 }
    );

  // Lấy template
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
    return NextResponse.json(
      { error: "Không tìm thấy template" },
      { status: 404 }
    );

  const tocDepth = Number.isFinite(Number(tpl.toc_depth))
    ? Math.min(6, Math.max(1, Number(tpl.toc_depth)))
    : 1;

  try {
    // 1) Build nodes
    const nodes = await buildNodesFromDB(admin, versionId);

    const year = new Date().getFullYear().toString();
    const token = (s?: string) =>
      (s || "")
        .replaceAll("{{BOOK_TITLE}}", esc(book.title))
        .replaceAll("{{YEAR}}", esc(year))
        .replaceAll("{{CHAPTER_TITLE}}", "");

    const cover = token(tpl.cover_html || "");
    const front = token(tpl.front_matter_html || "");
    const tocHtml = token(tpl.toc_html || "");
    const header = token(tpl.header_html || "");
    const footer = token(tpl.footer_html || "");

    const origin = getSiteOrigin(req);

    // Patch font URLs trong CSS template
    const patchedCss = (tpl.css || "")
      .replaceAll('url("/fonts/', `url("${origin}/fonts/`)
      .replaceAll("url('/fonts/", `url(\"${origin}/fonts/`)
      .replaceAll("url(/fonts/", `url(${origin}/fonts/`);

    // CJK fallback
    const cjkBase64 = loadCJKFontBase64();
    const cjkInlineCSS = cjkBase64
      ? `
@font-face {
  font-family: "CJK-Fallback";
  src: url("data:font/opentype;base64,${cjkBase64}") format("opentype");
  font-weight: normal;
  font-style: normal;
}
body, body * {
  font-family: "Times New Roman", "CJK-Fallback", serif !important;
}
`
      : `
body, body * {
  font-family: "Times New Roman", serif !important;
}
`;

    // 2) MAIN – giống render-pdf để giữ cấu trúc chương
    let chapterCounter = 0;
    const tocItems: string[] = [];

    const main = nodes
      .map((n) => {
        const isChapter = n.depth === 1;
        const tag = n.depth === 1 ? "h1" : n.depth === 2 ? "h2" : "h3";

        let label = esc(n.title);
        if (n.depth === 1) {
          chapterCounter += 1;
          label = `${chapterCounter}. ${label}`;
        }

        // TOC entry cho DOCX (nếu có dùng)
        if (n.depth >= 1 && n.depth <= tocDepth) {
          const pad = tocDepth > 1 ? Math.max(0, (n.depth - 1) * 14) : 0;
          const padAttr = pad ? ` style="padding-left:${pad}px"` : "";
          tocItems.push(
            `<li${padAttr}><a href="#${esc(n.id)}">${label}</a></li>`
          );
        }

        const bodyHtml =
          n.html && n.html.trim()
            ? n.html
            : `<p style="color:#777;"><em>(Chưa có nội dung)</em></p>`;

        return `
<section class="${isChapter ? "chapter" : "section"}" id="${esc(
          n.id
        )}" data-toc-item="${esc(
          n.toc_item_id
        )}" data-depth="${n.depth}" data-chapter-title="${esc(
          n.chapterTitle
        )}">
  <${tag} class="${
          isChapter ? "chapter-title" : ""
        }">${label}</${tag}>
  ${bodyHtml}
</section>`;
      })
      .join("\n");

    const tocList = tocItems.join("\n");

    // 3) HTML tổng – dùng cho html-to-docx
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${esc(book.title)} – v${version.version_no}</title>
  <style>
    ${cjkInlineCSS}
    ${patchedCss}
  </style>
</head>
<body>
  ${header || ""}

  ${cover || ""}

  ${front || ""}

  ${tocHtml || ""}
  <ol id="toc-list">
    ${tocList}
  </ol>

  <main id="book-content">
    ${main}
  </main>

  ${footer || ""}
</body>
</html>`;

    // 4) Gọi html-to-docx – chỉ 1 tham số để tránh lỗi
    const docxBuffer = await HTMLtoDOCX(html);

    const filenameSafe = book.title.replace(/[^a-zA-Z0-9\-_.]+/g, "_");
    const filename = `${filenameSafe || "book"}_v${
      version.version_no
    }.docx`;

    return new NextResponse(docxBuffer as any, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e: any) {
    console.error("Render DOCX failed:", e);
    return NextResponse.json(
      {
        error: "Render DOCX failed",
        detail: e?.message || String(e),
      },
      { status: 500 }
    );
  }
}
