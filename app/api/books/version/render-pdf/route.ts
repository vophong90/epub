// app/api/books/version/render-pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRouteClient } from "@/lib/supabaseServer";
import { getAdminClient } from "@/lib/supabase-admin";
import { renderPdfWithDocRaptor } from "@/lib/docraptor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BUCKET_PREVIEW = "pdf_previews";
const SIGNED_EXPIRES_SEC = 60 * 10;

type Body = {
  version_id?: string;
  template_id?: string;
  test?: boolean; // optional: override test flag (true/false)
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

  function walk(parentId: string | null, depth: number) {
    const kids = children.get(parentId) || [];
    for (const it of kids) {
      const anchor = makeAnchor(it.id);

      const c = contentByItem.get(it.id);
      const cj = c?.content_json || {};
      const html = typeof cj?.html === "string" ? cj.html : "";

      const kind: "section" | "chapter" | "heading" =
        it.kind === "section"
          ? "section"
          : it.kind === "chapter"
          ? "chapter"
          : depth === 1
          ? "chapter"
          : "heading";

      nodes.push({
        id: anchor,
        toc_item_id: it.id,
        title: it.title,
        slug: it.slug,
        kind,
        depth,
        html: html || "",
      });

      walk(it.id, depth + 1);
    }
  }

  walk(null, 1);
  return nodes;
}

/** Build TOC HTML with target-counter() => page number auto */
function buildTocHtml(nodes: RenderNode[], tocDepth: number) {
  // chỉ lấy section/chapter theo depth
  const entries = nodes
    .filter((n) => n.kind === "section" || n.kind === "chapter")
    .filter((n) => (n.kind === "section" ? 1 : 2) <= tocDepth)
    .map((n) => ({
      label: n.title,
      href: `#${n.id}`,
      level: n.kind === "section" ? 1 : 2,
    }));

  const rows = entries
    .map((e) => {
      const pad = e.level === 2 ? 18 : 0;
      return `
<li class="toc-item level-${e.level}" style="padding-left:${pad}px">
  <a class="toc-link" href="${esc(e.href)}">${esc(e.label)}</a>
</li>`;
    })
    .join("\n");

  // CSS quan trọng: leader + target-counter
  return `
<section class="toc2" id="__toc">
  <h1 class="toc2-title">Mục lục</h1>
  <ol class="toc2-list">
    ${rows}
  </ol>
</section>

<style>
.toc2{ break-after: page; page-break-after: always; margin: 0; }
.toc2-title{
  text-align:center;
  font-weight:800;
  font-size: 14pt;
  margin: 0 0 16px 0;
}
.toc2-list{ list-style:none; padding:0; margin:0; }
.toc-item{ margin: 2px 0; }
.toc-link{
  text-decoration:none;
  color: inherit;
  display: block;
}

/* ✅ số trang tự động: Prince/DocRaptor */
.toc-link::after{
  content: leader('.') " " target-counter(attr(href), page);
  float: right;
  font-variant-numeric: tabular-nums;
}
</style>
`;
}

function buildBaseHtmlDoc(params: {
  origin: string;
  title: string;
  cssFinal: string;
  bodyHtml: string;
}) {
  const { origin, title, cssFinal, bodyHtml } = params;

  // ✅ base href để các url tương đối (/fonts, /images) resolve đúng
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<base href="${origin}/" />
<title>${esc(title)}</title>
<style>
${cssFinal}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function absolutizeFontUrls(css: string, origin: string) {
  return (css || "")
    .replaceAll('url("/fonts/', `url("${origin}/fonts/`)
    .replaceAll("url('/fonts/", `url("${origin}/fonts/`)
    .replaceAll("url(/fonts/", `url(${origin}/fonts/`);
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
    return NextResponse.json({ error: "version_id là bắt buộc" }, { status: 400 });
  }

  const { data: version, error: vErr } = await admin
    .from("book_versions")
    .select("id,book_id,version_no,template_id")
    .eq("id", versionId)
    .maybeSingle<VersionRow>();

  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });
  if (!version) return NextResponse.json({ error: "Không tìm thấy version" }, { status: 404 });

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

    if (permErr) return NextResponse.json({ error: permErr.message }, { status: 500 });
    canRender = !!perm;
  }

  if (!canRender) {
    return NextResponse.json({ error: "Bạn không có quyền render PDF" }, { status: 403 });
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
    .select("id,name,css,cover_html,front_matter_html,toc_html,header_html,footer_html,page_size,page_margin_mm,toc_depth")
    .eq("id", templateId)
    .eq("is_active", true)
    .maybeSingle<TemplateRow>();

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (!tpl) return NextResponse.json({ error: "Không tìm thấy template" }, { status: 404 });

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
        .replaceAll("{{CHAPTER_TITLE}}", "") // nếu template bạn còn dùng
        .replaceAll("{{SITE_ORIGIN}}", origin);

    // ✅ CSS: thêm rules Paged Media cơ bản + absolutize /fonts
    const basePagedCss = `
@page { size: A4; margin: 20mm; }
@page:first { }
html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`;

    const cssAbs = absolutizeFontUrls(tpl.css || "", origin);
    const cssFinal = basePagedCss + "\n" + cssAbs;

    const nodes = await buildNodesFromDB(admin, versionId);

    // cover/front/content (content là 1 luồng HTML duy nhất để engine tự dàn trang)
    const coverBody = token(tpl.cover_html || "");
    const frontBody = token(tpl.front_matter_html || "");

    // ✅ TOC: ưu tiên tpl.toc_html nếu bạn muốn tự thiết kế,
    // nếu không có thì dùng buildTocHtml() auto.
    const tocBody =
      (tpl.toc_html && tpl.toc_html.trim())
        ? token(tpl.toc_html)
        : buildTocHtml(nodes, tocDepth);

    // ✅ Build content sections: section/chapter/heading
    // - Quan trọng: mỗi mục có id = anchor để TOC target-counter bắt đúng trang
    const contentBody = nodes
      .map((n) => {
        if (n.kind === "section") {
          return `
<section class="part" id="${esc(n.id)}">
  <h1 class="part-title">${esc(n.title)}</h1>
</section>`;
        }

        if (n.kind === "chapter") {
          const inner = n.html?.trim()
            ? n.html
            : `<p style="color:#777;"><em>(Chưa có nội dung)</em></p>`;

          return `
<section class="chapter" id="${esc(n.id)}">
  <h1 class="chapter-title">${esc(n.title)}</h1>
  <div class="chapter-body">${inner}</div>
</section>`;
        }

        // heading (nếu bạn muốn heading cũng link được từ TOC sau này)
        const inner = n.html?.trim()
          ? n.html
          : `<p style="color:#777;"><em>(Chưa có nội dung)</em></p>`;

        return `
<section class="heading" id="${esc(n.id)}">
  <h2 class="heading-title">${esc(n.title)}</h2>
  <div class="heading-body">${inner}</div>
</section>`;
      })
      .join("\n");

    // ✅ Gộp full HTML 1 lần (DocRaptor sẽ tự chia trang + tự ra TOC page numbers)
    const fullBody = `
${coverBody}
${frontBody}
${tocBody}
<main id="book-content">
${contentBody}
</main>
`;

    const fullHtml = buildBaseHtmlDoc({
      origin,
      title: book.title,
      cssFinal,
      bodyHtml: fullBody,
    });

    // ✅ test flag
    // - Nếu bạn dùng Free plan: nên để true (trial)
    // - Khi nâng plan production: set false
    const testFlag =
      typeof body.test === "boolean"
        ? body.test
        : process.env.NODE_ENV !== "production"; // dev=true, prod=false

    const pdfBuffer = await renderPdfWithDocRaptor({
      html: fullHtml,
      name: `book-${book.id}-v${version.version_no}.pdf`,
      test: testFlag,
    });

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
      meta: {
        toc_depth: tocDepth,
        nodes: nodes.length,
        test: testFlag,
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

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      route: "/api/books/version/render-pdf",
      methods: ["POST"],
      note: "DocRaptor enabled",
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: "POST, GET, OPTIONS",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, authorization",
    },
  });
}
