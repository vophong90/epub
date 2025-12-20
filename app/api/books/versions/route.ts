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
  if (!perm && !isAdmin) {
    return NextResponse.json(
      { error: "Bạn không có quyền truy cập sách này" },
      { status: 403 }
    );
  }

  const { data, error } = await supabase
    .from("book_versions")
    .select(
      "id,book_id,version_no,status,created_at,created_by,approved_by,approved_at,locked_by,locked_at,template_id"
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

/**
 * POST: Tạo phiên bản mới cho 1 book, kèm theo template_id nếu có.
 * Body:
 * {
 *   "book_id": "uuid",
 *   "template_id": "uuid | null",   // optional
 *   "status": "draft" | "published" | ... // optional, mặc định "draft"
 * }
 */
export async function POST(req: NextRequest) {
  const supabase = getRouteClient();

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const bookId = (body.book_id || "").toString().trim();
  const templateId = (body.template_id || null) as string | null;
  const status = (body.status || "draft").toString().trim() || "draft";

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

  // Lấy profile để biết system_role
  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("id,system_role")
    .eq("id", user.id)
    .maybeSingle();

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }

  const isAdmin = profile?.system_role === "admin";

  // Check quyền: admin hoặc có book_permissions (author/editor/viewer)
  const { data: perm, error: permErr } = await supabase
    .from("book_permissions")
    .select("role")
    .eq("book_id", bookId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (permErr) {
    return NextResponse.json({ error: permErr.message }, { status: 500 });
  }

  if (!perm && !isAdmin) {
    return NextResponse.json(
      { error: "Bạn không có quyền tạo phiên bản cho sách này" },
      { status: 403 }
    );
  }

  // Tìm version_no lớn nhất hiện tại để +1
  const { data: latest, error: vErr } = await supabase
    .from("book_versions")
    .select("version_no")
    .eq("book_id", bookId)
    .order("version_no", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (vErr) {
    return NextResponse.json({ error: vErr.message }, { status: 500 });
  }

  // ✅ Fix: tách giá trị ra trước, xử lý khi latest = null
  const latestVersionNo =
    latest && latest.version_no != null ? Number(latest.version_no) : 0;

  const nextVersionNo = latestVersionNo > 0 ? latestVersionNo + 1 : 1;

  const { data: inserted, error: insErr } = await supabase
    .from("book_versions")
    .insert({
      book_id: bookId,
      version_no: nextVersionNo,
      status,
      created_by: user.id,
      template_id: templateId || null,
    })
    .select(
      "id,book_id,version_no,status,created_at,created_by,approved_by,approved_at,locked_by,locked_at,template_id"
    )
    .maybeSingle();

  if (insErr || !inserted) {
    return NextResponse.json(
      {
        error: "Không tạo được phiên bản mới",
        detail: insErr?.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    version: inserted,
  });
}

/**
 * PATCH: Cập nhật 1 version (hiện tại chủ yếu dùng để update template_id, status nếu cần).
 * Body:
 * {
 *   "id": "version_id",
 *   "template_id": "uuid | null",   // optional
 *   "status": "..."                 // optional
 * }
 */
export async function PATCH(req: NextRequest) {
  const supabase = getRouteClient();

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const versionId = (body.id || "").toString().trim();
  const templateId =
    typeof body.template_id !== "undefined"
      ? (body.template_id as string | null)
      : undefined;
  const status =
    typeof body.status !== "undefined"
      ? (body.status as string).toString().trim()
      : undefined;

  if (!versionId) {
    return NextResponse.json(
      { error: "id (version_id) là bắt buộc" },
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

  // Lấy profile để biết system_role
  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("id,system_role")
    .eq("id", user.id)
    .maybeSingle();

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }

  const isAdmin = profile?.system_role === "admin";

  // Lấy version để biết book_id
  const { data: version, error: vErr } = await supabase
    .from("book_versions")
    .select(
      "id,book_id,version_no,status,template_id,created_at,created_by,approved_by,approved_at,locked_by,locked_at"
    )
    .eq("id", versionId)
    .maybeSingle();

  if (vErr) {
    return NextResponse.json({ error: vErr.message }, { status: 500 });
  }
  if (!version) {
    return NextResponse.json(
      { error: "Không tìm thấy phiên bản sách" },
      { status: 404 }
    );
  }

  // Kiểm tra quyền với book tương ứng
  const { data: perm, error: permErr } = await supabase
    .from("book_permissions")
    .select("role")
    .eq("book_id", version.book_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (permErr) {
    return NextResponse.json({ error: permErr.message }, { status: 500 });
  }

  if (!perm && !isAdmin) {
    return NextResponse.json(
      { error: "Bạn không có quyền chỉnh sửa phiên bản này" },
      { status: 403 }
    );
  }

  const patch: Record<string, any> = {};
  if (typeof templateId !== "undefined") {
    patch.template_id = templateId;
  }
  if (typeof status !== "undefined" && status) {
    patch.status = status;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "Không có trường nào để cập nhật" },
      { status: 400 }
    );
  }

  const { data: updated, error: upErr } = await supabase
    .from("book_versions")
    .update(patch)
    .eq("id", versionId)
    .select(
      "id,book_id,version_no,status,created_at,created_by,approved_by,approved_at,locked_by,locked_at,template_id"
    )
    .maybeSingle();

  if (upErr || !updated) {
    return NextResponse.json(
      {
        error: "Không cập nhật được phiên bản",
        detail: upErr?.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    version: updated,
  });
}
