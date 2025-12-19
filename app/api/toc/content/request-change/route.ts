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

  // 1) Lấy item + version + kiểm tra editor
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
    .select("id,book_id,status")
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
    .maybeSingle();

  if (pErr || perm?.role !== "editor") {
    return NextResponse.json(
      { error: "Chỉ editor mới được yêu cầu chỉnh sửa" },
      { status: 403 }
    );
  }

  if (version.status === "published") {
    return NextResponse.json(
      { error: "Phiên bản sách đã publish, không thể yêu cầu chỉnh sửa" },
      { status: 400 }
    );
  }

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
      { error: "Chưa có nội dung để yêu cầu chỉnh sửa" },
      { status: 404 }
    );
  }

  if (content.status !== "submitted") {
    return NextResponse.json(
      {
        error: "Chỉ được yêu cầu chỉnh sửa khi nội dung đang ở 'submitted'",
        current_status: content.status,
      },
      { status: 400 }
    );
  }

  // 2) Cập nhật status -> needs_revision
  const { data: updated, error: uErr } = await supabase
    .from("toc_contents")
    .update({
      status: "needs_revision",
      updated_by: user!.id,
    })
    .eq("toc_item_id", tocItemId)
    .select("toc_item_id,status,updated_at,updated_by")
    .maybeSingle();

  if (uErr) {
    return NextResponse.json({ error: uErr.message }, { status: 403 });
  }

  return NextResponse.json({ ok: true, content: updated });
}
