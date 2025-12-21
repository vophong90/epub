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
 *  - authenticated là được xem (bạn có thể siết lại chỉ admin nếu muốn)
 */
export async function GET(req: NextRequest) {
  const supabase = getRouteClient();

  // auth
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

  return NextResponse.json({
    ok: true,
    templates: data ?? [],
  });
}
