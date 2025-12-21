// app/api/book-templates/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRouteClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TEMPLATE_CSS = `/* ===== Page setup ===== */
@page {
  size: A4;
  margin-top: 20mm;
  margin-bottom: 20mm;
  margin-left: 18mm;
  margin-right: 18mm;

  @top-left { content: element(runningHeaderLeft); }
  @top-right { content: element(runningHeaderRight); }

  @bottom-center {
    content: counter(page);
    font-size: 10px;
    font-family: "Times New Roman", serif;
  }
}

/* ===== Global ===== */
html, body { margin: 0; padding: 0; }

body {
  font-family: "Times New Roman", serif;
  font-size: 13pt;
  line-height: 1.5;
  text-align: justify;
}

p { margin: 0 0 0.6em 0; text-align: justify; }

/* Cover */
section.cover {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100vh;
  text-align: center;
  page-break-after: always;
}

section.cover h1 { font-size: 26pt; margin-bottom: 1rem; font-family: "Times New Roman", serif; }
section.cover h2 { font-size: 16pt; margin-top: 0; font-family: "Times New Roman", serif; }

/* Front matter */
section.front-matter { page-break-after: always; }

/* TOC */
nav.toc { page-break-after: always; }
nav.toc h1 {
  font-size: 16pt;
  font-weight: bold;
  text-transform: uppercase;
  text-align: center;
  margin-bottom: 1rem;
  font-family: "Times New Roman", serif;
}
nav.toc ol { list-style: none; padding-left: 0; }
nav.toc li { display: flex; align-items: baseline; font-size: 11pt; margin: 2px 0; font-family: "Times New Roman", serif; }
nav.toc li a { flex: 1 1 auto; text-decoration: none; color: inherit; }
nav.toc li .dots { flex: 0 0 auto; border-bottom: 1px dotted #aaa; margin: 0 4px; height: 0; }
nav.toc li .page { flex: 0 0 auto; min-width: 24px; text-align: right; }

/* Chapters */
section.chapter { page-break-before: always; }

/* CHƯƠNG: size 16, IN HOA, canh giữa, in đậm */
h1.chapter-title {
  font-family: "Times New Roman", serif;
  font-size: 16pt;
  font-weight: bold;
  text-transform: uppercase;
  text-align: center;
  margin: 0 0 0.75rem 0;
}

/* Heading-2: size 13, in đậm, IN HOA, canh đều */
h2 {
  font-family: "Times New Roman", serif;
  font-size: 13pt;
  font-weight: bold;
  text-transform: uppercase;
  text-align: justify;
  margin-top: 0.75rem;
  margin-bottom: 0.25rem;
}

h3 {
  font-family: "Times New Roman", serif;
  font-size: 13pt;
  font-weight: bold;
  text-align: justify;
  margin-top: 0.75rem;
  margin-bottom: 0.25rem;
}
`;

/**
 * GET /api/book-templates
 * Query: active=1|0 (default 1)
 */
export async function GET(req: NextRequest) {
  const supabase = getRouteClient();

  const { data: { user }, error: uErr } = await supabase.auth.getUser();
  if (uErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const activeParam = (searchParams.get("active") || "1").trim();
  const onlyActive = activeParam !== "0";

  let q = supabase
    .from("book_templates")
    .select(
      "id,name,description,page_size,page_margin_mm,is_active,created_by,created_at"
    )
    .order("created_at", { ascending: false });

  if (onlyActive) q = q.eq("is_active", true);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, templates: data ?? [] });
}

/**
 * POST /api/book-templates
 * Body JSON:
 * - name (required)
 * - description?
 * - css? (optional; default CSS nếu thiếu)
 * - page_size?
 * - page_margin_mm?
 * - cover_html?, front_matter_html?, toc_html?, header_html?, footer_html?
 * - is_active?
 *
 * Quyền: chỉ admin
 */
export async function POST(req: NextRequest) {
  const supabase = getRouteClient();

  const { data: { user }, error: uErr } = await supabase.auth.getUser();
  if (uErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Admin check
  const { data: prof, error: pErr } = await supabase
    .from("profiles")
    .select("id, system_role")
    .eq("id", user.id)
    .maybeSingle();

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!prof || prof.system_role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = (body?.name ?? "").toString().trim();
  if (!name) return NextResponse.json({ error: "name là bắt buộc" }, { status: 400 });

  const description =
    body?.description === undefined ? null : (body.description ?? null);

  const page_size = (body?.page_size ?? "A4").toString().trim() || "A4";

  const defaultMargin = { top: 20, bottom: 20, left: 18, right: 18 };
  const m = body?.page_margin_mm ?? defaultMargin;
  const page_margin_mm = {
    top: Number(m?.top ?? defaultMargin.top),
    bottom: Number(m?.bottom ?? defaultMargin.bottom),
    left: Number(m?.left ?? defaultMargin.left),
    right: Number(m?.right ?? defaultMargin.right),
  };
  for (const k of ["top", "bottom", "left", "right"] as const) {
    const v = page_margin_mm[k];
    if (!Number.isFinite(v) || v < 0 || v > 60) {
      return NextResponse.json({ error: `page_margin_mm.${k} không hợp lệ` }, { status: 400 });
    }
  }

  const css =
    typeof body?.css === "string" && body.css.trim().length > 0
      ? body.css
      : DEFAULT_TEMPLATE_CSS;

  const is_active =
    body?.is_active === undefined ? true : Boolean(body.is_active);

  // Optional HTML blocks (null nếu thiếu)
  const cover_html =
    body?.cover_html === undefined ? null : (body.cover_html ?? null);
  const front_matter_html =
    body?.front_matter_html === undefined ? null : (body.front_matter_html ?? null);
  const toc_html =
    body?.toc_html === undefined ? null : (body.toc_html ?? null);
  const header_html =
    body?.header_html === undefined ? null : (body.header_html ?? null);
  const footer_html =
    body?.footer_html === undefined ? null : (body.footer_html ?? null);

  const { data: inserted, error: insErr } = await supabase
    .from("book_templates")
    .insert({
      name,
      description,
      page_size,
      page_margin_mm,
      css,
      cover_html,
      front_matter_html,
      toc_html,
      header_html,
      footer_html,
      is_active,
      created_by: user.id,
    })
    .select(
      "id,name,description,page_size,page_margin_mm,css,cover_html,front_matter_html,toc_html,header_html,footer_html,is_active,created_by,created_at"
    )
    .single();

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, template: inserted });
}
