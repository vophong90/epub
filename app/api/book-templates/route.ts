// app/api/book-templates/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRouteClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/book-templates
 * Query:
 *  - active=1|0 (default 1): chỉ lấy template is_active=true
 *
 * Quyền:
 *  - authenticated là được xem
 */
export async function GET(req: NextRequest) {
  const supabase = getRouteClient();

  const {
    data: { user },
    error: uErr,
  } = await supabase.auth.getUser();

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

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, templates: data ?? [] });
}

/**
 * POST /api/book-templates
 * Body JSON:
 *  - name: string (required)
 *  - description?: string | null
 *  - page_size?: string (default "A4")
 *  - page_margin_mm?: { top:number; bottom:number; left:number; right:number } (default 20/20/18/18)
 *  - is_active?: boolean (default true)
 *
 * Quyền:
 *  - chỉ admin (profiles.system_role='admin') mới được tạo
 */
export async function POST(req: NextRequest) {
  const supabase = getRouteClient();

  const {
    data: { user },
    error: uErr,
  } = await supabase.auth.getUser();

  if (uErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check admin
  const { data: prof, error: pErr } = await supabase
    .from("profiles")
    .select("id, system_role")
    .eq("id", user.id)
    .maybeSingle();

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }
  if (!prof || prof.system_role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Parse body
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = (body?.name ?? "").toString().trim();
  if (!name) {
    return NextResponse.json({ error: "name là bắt buộc" }, { status: 400 });
  }

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

  // basic validation
  for (const k of ["top", "bottom", "left", "right"] as const) {
    const v = page_margin_mm[k];
    if (!Number.isFinite(v) || v < 0 || v > 60) {
      return NextResponse.json(
        { error: `page_margin_mm.${k} không hợp lệ` },
        { status: 400 }
      );
    }
  }

  const is_active =
    body?.is_active === undefined ? true : Boolean(body.is_active);

  const { data: inserted, error: insErr } = await supabase
    .from("book_templates")
    .insert({
      name,
      description,
      page_size,
      page_margin_mm,
      is_active,
      created_by: user.id,
    })
    .select(
      "id,name,description,page_size,page_margin_mm,is_active,created_by,created_at"
    )
    .single();

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, template: inserted });
}
