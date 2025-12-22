// app/api/books/version/render-docx/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRouteClient } from "@/lib/supabaseServer";
import { getAdminClient } from "@/lib/supabase-admin";

// html-to-docx là CommonJS
// eslint-disable-next-line @typescript-eslint/no-var-requires
const HTMLtoDOCX: any = require("html-to-docx");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Body: cho phép override template_id từ UI (giống render-pdf)
type Body = {
  version_id?: string;
  template_id?: string;
};

function esc(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** DB row types tối giản */
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
  id: string; // anchor id
  toc_item_id: string;
  title: string;
  slug: string;
  depth: number; // 1 = chapter
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
 * Pagination helpers (reuse từ render-pdf)
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

  return nodes;
}

/* =========================
 * Handler
 * ========================= */

export async function POST(req: NextRequest) {
  const supabase = getRouteClient();
  const admin = getAdminClient();

  // 1) Auth
  const {
    data: { user },
    error: uErr,
  } = await supabase.auth.getUser();

  if (uErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2) Body
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

  // 3) Load version
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

  // Ưu tiên template từ body, nếu không có thì dùng version.template_id
  let templateId = (body.template_id || "").toString().trim();
  if (!templateId) templateId = version.template_id || "";

  if (!templateId) {
    return NextResponse.json(
      { error: "Chưa xác định được template cho phiên bản này" },
      { status: 400 }
    );
  }

  // 4) Quyền: admin OR (author/editor trên book)
  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("id,system_role")
    .eq("id", user.id)
    .maybeSingle();

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  const isAdmin = profile?.system_role === "admin";
  let canExport = isAdmin;

  if (!canExport) {
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

    canExport = !!perm;
  }

  if (!canExport) {
    return NextResponse.json(
      { error: "Bạn không có quyền xuất DOCX" },
      { status: 403 }
    );
  }

  // 5) Load book
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

  // 6) Load template
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

  try {
    // 7) Build nodes (toàn bộ sách, giống render-pdf)
    const nodes = await buildNodesFromDB(admin, versionId);
    if (!nodes.length) {
      return NextResponse.json(
        { error: "Version này chưa có nội dung để xuất DOCX" },
        { status: 400 }
      );
    }

    const year = new Date().getFullYear().toString();
    const token = (s?: string) =>
      (s || "")
        .replaceAll("{{BOOK_TITLE}}", esc(book.title))
        .replaceAll("{{YEAR}}", esc(year))
        .replaceAll("{{CHAPTER_TITLE}}", "");

    const cover = token(tpl.cover_html || "");
    const front = token(tpl.front_matter_html || "");
    const header = token(tpl.header_html || "");
    const footer = token(tpl.footer_html || "");
    // TOC: có thể dùng lại, nhưng Word sẽ không tự link lại như Paged.js
    const tocTemplate = token(tpl.toc_html || "");

    // Tạm dùng CSS template “nguyên xi” – Word sẽ hiểu được 1 phần:
    // h1/h2/h3, font-size, text-align, margin...
    const css = tpl.css || "";

    // MAIN: đơn giản hóa, bỏ running-header phức tạp.
    let chapterCounter = 0;

    const mainHtml = nodes
      .map((n) => {
        const isChapter = n.depth === 1;
        const tag = n.depth === 1 ? "h1" : n.depth === 2 ? "h2" : "h3";

        let title = esc(n.title);
        if (isChapter) {
          chapterCounter += 1;
          title = `${chapterCounter}. ${title}`;
        }

        const bodyHtml =
          n.html && n.html.trim()
            ? n.html
            : `<p style="color:#777;"><em>(Chưa có nội dung)</em></p>`;

        return `
<section class="${isChapter ? "chapter" : "section"}" id="${esc(
          n.id
        )}" data-depth="${n.depth}">
  <${tag} class="${isChapter ? "chapter-title" : ""}">${title}</${tag}>
  ${bodyHtml}
</section>`;
      })
      .join("\n");

    // Ghép TOC đơn giản: list toàn bộ chương depth=1
    const tocItems: string[] = [];
    let tmpCount = 0;
    for (const n of nodes) {
      if (n.depth !== 1) continue;
      tmpCount += 1;
      tocItems.push(
        `<p>${tmpCount}. ${esc(n.title)} (chương)</p>`
      );
    }
    const tocHtml =
      tocTemplate ||
      (tocItems.length
        ? `<h2>Mục lục</h2>\n${tocItems.join("\n")}`
        : "");

    const fullHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${esc(book.title)} – v${version.version_no}</title>
  <style>
  ${css}
  </style>
</head>
<body>
  ${cover || ""}
  ${front || ""}

  ${tocHtml || ""}

  ${header || ""}

  <main id="book-content">
    ${mainHtml}
  </main>

  ${footer || ""}
</body>
</html>`;

    // 8) HTML -> DOCX
    const fileNameSafeTitle = book.title.replace(/[^a-zA-Z0-9\-_.]+/g, "_");
    const docxBuffer: Buffer = await HTMLtoDOCX(fullHtml, null, {
      // vài option cơ bản, có thể tinh chỉnh thêm nếu muốn
      header: true,
      footer: true,
      pageNumber: true,
    });

    const filename = `book-${fileNameSafeTitle}-v${version.version_no}.docx`;

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
