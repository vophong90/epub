import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tocItemId = searchParams.get("toc_item_id") || "";
  if (!tocItemId) return NextResponse.json({ error: "toc_item_id là bắt buộc" }, { status: 400 });

  const { supabase, user, error } = await requireUser();
  if (error) return error;

  // toc item
  const { data: item, error: iErr } = await supabase
    .from("toc_items")
    .select("id,book_version_id,parent_id,title,slug,order_index")
    .eq("id", tocItemId)
    .maybeSingle();

  if (iErr || !item) {
    return NextResponse.json({ error: "Không tìm thấy TOC item" }, { status: 404 });
  }

  // Role in book
  const { data: version, error: vErr } = await supabase
    .from("book_versions")
    .select("id,book_id")
    .eq("id", item.book_version_id)
    .maybeSingle();
  if (vErr || !version?.book_id) {
    return NextResponse.json({ error: "Không tìm thấy phiên bản sách" }, { status: 404 });
  }

  const { data: perm, error: pErr } = await supabase
    .from("book_permissions")
    .select("role")
    .eq("book_id", version.book_id)
    .eq("user_id", user!.id)
    .maybeSingle();
  if (pErr || !perm?.role) {
    return NextResponse.json({ error: "Bạn không có quyền truy cập" }, { status: 403 });
  }

  // content
  const { data: content, error: cErr } = await supabase
    .from("toc_contents")
    .select("toc_item_id,content_json,updated_at,updated_by")
    .eq("toc_item_id", tocItemId)
    .maybeSingle();

  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }

  // assignments
  const { data: assigns, error: aErr } = await supabase
    .from("toc_assignments")
    .select("id,toc_item_id,user_id,role_in_item")
    .eq("toc_item_id", tocItemId);
  if (aErr) {
    return NextResponse.json({ error: aErr.message }, { status: 500 });
  }

  return NextResponse.json({
    item,
    role: perm.role,
    book_id: version.book_id,
    content: content ?? null,
    assignments: assigns ?? [],
  });
}
