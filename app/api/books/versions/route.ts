// app/api/books/versions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRouteClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = getRouteClient();

  const { searchParams } = new URL(req.url);
  const bookId = searchParams.get("book_id") || "";
  if (!bookId) {
    return NextResponse.json(
      { error: "book_id là bắt buộc" },
      { status: 400 }
    );
  }

  // Lấy user
  const {
    data: { user },
    error: uErr,
  } = await supabase.auth.getUser();
  if (uErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Lấy profile để biết system_role (admin hay không)
  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("id,system_role")
    .eq("id", user.id)
    .maybeSingle();

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }

  const isAdmin = profile?.system_role === "admin";

  // Tối thiểu phải có quyền xem sách (book_permissions) mới xem danh sách version
  const { data: perm, error: permErr } = await supabase
    .from("book_permissions")
    .select("role")
    .eq("book_id", bookId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (permErr) {
    return NextResponse.json({ error: permErr.message }, { status: 500 });
  }
  if (!perm) {
    return NextResponse.json(
      { error: "Bạn không có quyền truy cập sách này" },
      { status: 403 }
    );
  }

  const { data, error } = await supabase
    .from("book_versions")
    .select(
      "id,book_id,version_no,status,created_at,created_by,approved_by,approved_at,locked_by,locked_at"
    )
    .eq("book_id", bookId)
    .order("version_no", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    is_admin: isAdmin,
    versions: data ?? [],
  });
}
