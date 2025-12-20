// app/api/toc/assignments/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Kiểm tra: user hiện tại có phải là editor của sách chứa toc_item này hay không.
 * Trả về:
 *  - ok: false + res: NextResponse nếu lỗi / không đủ quyền
 *  - ok: true + book_id nếu user là editor.
 */
async function requireEditorByTocItemId(
  supabase: any,
  userId: string,
  tocItemId: string
): Promise<{ ok: false; res: NextResponse } | { ok: true; book_id: string }> {
  // 1) Lấy toc_item -> book_version_id
  const { data: item, error: iErr } = await supabase
    .from("toc_items")
    .select("id, book_version_id")
    .eq("id", tocItemId)
    .maybeSingle();

  if (iErr || !item) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "Không tìm thấy TOC item" },
        { status: 404 }
      ),
    };
  }

  // 2) Lấy book_version -> book_id
  const { data: version, error: vErr } = await supabase
    .from("book_versions")
    .select("id, book_id")
    .eq("id", item.book_version_id)
    .maybeSingle();

  if (vErr || !version?.book_id) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "Không tìm thấy phiên bản sách" },
        { status: 404 }
      ),
    };
  }

  // 3) Kiểm tra user hiện tại có role = 'editor' ở cấp sách hay không
  const { data: perm, error: pErr } = await supabase
    .from("book_permissions")
    .select("role")
    .eq("book_id", version.book_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (pErr || perm?.role !== "editor") {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "Chỉ editor mới được phân công" },
        { status: 403 }
      ),
    };
  }

  return { ok: true, book_id: version.book_id as string };
}

/**
 * POST /api/toc/assignments
 * Body JSON: { toc_item_id, user_id, role_in_item? = "author" }
 *
 * Logic mới:
 *  - Caller phải là editor của sách (requireEditorByTocItemId).
 *  - Nếu user_id chưa có trong book_permissions của sách:
 *      -> Tự động tạo book_permissions với role = 'author'.
 *  - Sau đó upsert vào toc_assignments (toc_item_id, user_id, role_in_item).
 */
export async function POST(req: NextRequest) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const toc_item_id = String(body.toc_item_id || "");
  const user_id = String(body.user_id || "");
  const role_in_item = String(body.role_in_item || "author");

  if (!toc_item_id) {
    return NextResponse.json(
      { error: "toc_item_id là bắt buộc" },
      { status: 400 }
    );
  }
  if (!user_id) {
    return NextResponse.json(
      { error: "user_id là bắt buộc" },
      { status: 400 }
    );
  }

  // 1) Caller phải là editor của sách
  const gate = await requireEditorByTocItemId(supabase, user!.id, toc_item_id);
  if (!gate.ok) return (gate as any).res;
  const book_id = gate.book_id;

  // 2) Đảm bảo user được phân công là thành viên của sách
  //    Nếu chưa có book_permissions -> auto tạo với role = 'author'
  const { data: memberPerm, error: memberErr } = await supabase
    .from("book_permissions")
    .select("id, role")
    .eq("book_id", book_id)
    .eq("user_id", user_id)
    .maybeSingle();

  if (memberErr) {
    return NextResponse.json(
      { error: memberErr.message || "Lỗi kiểm tra book_permissions" },
      { status: 400 }
    );
  }

  if (!memberPerm) {
    // Chưa là thành viên sách -> tự thêm vào với role = 'author'
    const { data: newPerm, error: insPermErr } = await supabase
      .from("book_permissions")
      .insert({
        book_id,
        user_id,
        role: "author", // mặc định: được thêm qua phân công thì là author ở cấp sách
      })
      .select("id, role")
      .maybeSingle();

    if (insPermErr || !newPerm) {
      return NextResponse.json(
        {
          error:
            insPermErr?.message ||
            "Không tạo được quyền ở cấp sách cho user được phân công",
        },
        { status: 400 }
      );
    }
  }
  // Nếu đã có memberPerm thì giữ nguyên role hiện tại (viewer/author/editor)

  // 3) Upsert assignment ở cấp TOC
  const { data, error: insErr } = await supabase
    .from("toc_assignments")
    .upsert({ toc_item_id, user_id, role_in_item })
    .select("id, toc_item_id, user_id, role_in_item")
    .maybeSingle();

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, assignment: data });
}

/**
 * DELETE /api/toc/assignments?toc_item_id=...&user_id=...
 *
 * Chỉ xoá phân công ở cấp TOC, KHÔNG xoá book_permissions.
 */
export async function DELETE(req: NextRequest) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const toc_item_id = searchParams.get("toc_item_id") || "";
  const user_id = searchParams.get("user_id") || "";

  if (!toc_item_id) {
    return NextResponse.json(
      { error: "toc_item_id là bắt buộc" },
      { status: 400 }
    );
  }
  if (!user_id) {
    return NextResponse.json(
      { error: "user_id là bắt buộc" },
      { status: 400 }
    );
  }

  // Caller vẫn phải là editor của sách chứa toc_item
  const gate = await requireEditorByTocItemId(supabase, user!.id, toc_item_id);
  if (!gate.ok) return (gate as any).res;

  const { error: delErr } = await supabase
    .from("toc_assignments")
    .delete()
    .eq("toc_item_id", toc_item_id)
    .eq("user_id", user_id);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
