// app/api/toc/content/resolve-note/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  toc_item_id?: string;
};

export async function POST(req: NextRequest) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const tocItemId = (body.toc_item_id || "").toString();
  if (!tocItemId) {
    return NextResponse.json(
      { error: "toc_item_id là bắt buộc" },
      { status: 400 }
    );
  }

  // 1) Lấy content hiện tại
  const { data: content, error: cErr } = await supabase
    .from("toc_contents")
    .select("toc_item_id,status")
    .eq("toc_item_id", tocItemId)
    .maybeSingle();

  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }
  if (!content) {
    return NextResponse.json(
      { error: "Chưa có nội dung để đánh dấu ghi chú" },
      { status: 404 }
    );
  }

  if (content.status !== "needs_revision") {
    return NextResponse.json(
      {
        error: "Chỉ được đánh dấu đã giải quyết khi nội dung đang ở 'needs_revision'",
        current_status: content.status,
      },
      { status: 400 }
    );
  }

  // 2) Lấy TOC item + version + quyền ở sách
  const { data: item, error: iErr } = await supabase
    .from("toc_items")
    .select("id,book_version_id")
    .eq("id", tocItemId)
    .maybeSingle();

  if (iErr || !item) {
    return NextResponse.json(
      { error: "Không tìm thấy TOC item" },
      { status: 404 }
    );
  }

  const { data: version, error: vErr } = await supabase
    .from("book_versions")
    .select("id,book_id")
    .eq("id", item.book_version_id)
    .maybeSingle();

  if (vErr || !version?.book_id) {
    return NextResponse.json(
      { error: "Không tìm thấy phiên bản sách" },
      { status: 404 }
    );
  }

  const { data: perm, error: pErr } = await supabase
    .from("book_permissions")
    .select("role")
    .eq("book_id", version.book_id)
    .eq("user_id", user!.id)
    .maybeSingle<{ role: "viewer" | "author" | "editor" }>();

  if (pErr || !perm?.role) {
    return NextResponse.json(
      { error: "Bạn không có quyền với sách này" },
      { status: 403 }
    );
  }

  // 3) Chỉ cho phép:
  // - Editor
  // - Hoặc author được phân công cho mục này
  let allowed = false;

  if (perm.role === "editor") {
    allowed = true;
  } else if (perm.role === "author") {
    const { data: assignment } = await supabase
      .from("toc_assignments")
      .select("id,role_in_item")
      .eq("toc_item_id", tocItemId)
      .eq("user_id", user!.id)
      .maybeSingle<{ id: string; role_in_item: "author" | "editor" }>();

    if (assignment && assignment.role_in_item === "author") {
      allowed = true;
    }
  }

  if (!allowed) {
    return NextResponse.json(
      { error: "Chỉ tác giả được phân công hoặc editor mới được đánh dấu đã giải quyết" },
      { status: 403 }
    );
  }

  // 4) Cập nhật author_resolved = true
  const { data: updated, error: uErr } = await supabase
    .from("toc_contents")
    .update({
      author_resolved: true,
      updated_by: user!.id,
    })
    .eq("toc_item_id", tocItemId)
    .select("toc_item_id,status,updated_at,updated_by,editor_note,author_resolved")
    .maybeSingle();

  if (uErr) {
    return NextResponse.json({ error: uErr.message }, { status: 403 });
  }

  return NextResponse.json({ ok: true, content: updated });
}
