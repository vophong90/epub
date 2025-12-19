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

  // 1) Lấy trạng thái hiện tại
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
      { error: "Chưa có nội dung để nộp (toc_contents trống)" },
      { status: 404 }
    );
  }

  if (
    content.status !== "draft" &&
    content.status !== "needs_revision"
  ) {
    return NextResponse.json(
      {
        error:
          "Chỉ được nộp nội dung ở trạng thái 'draft' hoặc 'needs_revision'",
        current_status: content.status,
      },
      { status: 400 }
    );
  }

  // 2) Cập nhật status -> submitted
  const { data: updated, error: uErr } = await supabase
    .from("toc_contents")
    .update({
      status: "submitted",
      updated_by: user!.id,
    })
    .eq("toc_item_id", tocItemId)
    .select("toc_item_id,status,updated_at,updated_by")
    .maybeSingle();

  if (uErr) {
    // Có thể là lỗi RLS (không phải author được phân công, hoặc version đã publish,...)
    return NextResponse.json({ error: uErr.message }, { status: 403 });
  }

  return NextResponse.json({ ok: true, content: updated });
}
