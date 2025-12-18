import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireEditorByTocItemId(supabase: any, userId: string, tocItemId: string) {
  const { data: item, error: iErr } = await supabase
    .from("toc_items")
    .select("id,book_version_id")
    .eq("id", tocItemId)
    .maybeSingle();
  if (iErr || !item) {
    return { ok: false, res: NextResponse.json({ error: "Không tìm thấy TOC item" }, { status: 404 }) };
  }

  const { data: version, error: vErr } = await supabase
    .from("book_versions")
    .select("id,book_id")
    .eq("id", item.book_version_id)
    .maybeSingle();
  if (vErr || !version?.book_id) {
    return { ok: false, res: NextResponse.json({ error: "Không tìm thấy phiên bản sách" }, { status: 404 }) };
  }

  const { data: perm, error: pErr } = await supabase
    .from("book_permissions")
    .select("role")
    .eq("book_id", version.book_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (pErr || perm?.role !== "editor") {
    return { ok: false, res: NextResponse.json({ error: "Chỉ editor mới được phân công" }, { status: 403 }) };
  }

  return { ok: true, book_id: version.book_id as string };
}

export async function POST(req: NextRequest) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const toc_item_id = String(body.toc_item_id || "");
  const user_id = String(body.user_id || "");
  const role_in_item = String(body.role_in_item || "author");

  if (!toc_item_id) return NextResponse.json({ error: "toc_item_id là bắt buộc" }, { status: 400 });
  if (!user_id) return NextResponse.json({ error: "user_id là bắt buộc" }, { status: 400 });

  const gate = await requireEditorByTocItemId(supabase, user!.id, toc_item_id);
  if (!gate.ok) return (gate as any).res;

  // Optional: ensure assigned user is a member of the book (has book_permissions)
  const { data: memberPerm } = await supabase
    .from("book_permissions")
    .select("id")
    .eq("book_id", gate.book_id)
    .eq("user_id", user_id)
    .maybeSingle();
  if (!memberPerm) {
    return NextResponse.json(
      { error: "User này chưa được phân quyền ở cấp sách (book_permissions)" },
      { status: 400 }
    );
  }

  const { data, error: insErr } = await supabase
    .from("toc_assignments")
    .upsert({ toc_item_id, user_id, role_in_item })
    .select("id,toc_item_id,user_id,role_in_item")
    .maybeSingle();

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });
  return NextResponse.json({ ok: true, assignment: data });
}

export async function DELETE(req: NextRequest) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const toc_item_id = searchParams.get("toc_item_id") || "";
  const user_id = searchParams.get("user_id") || "";

  if (!toc_item_id) return NextResponse.json({ error: "toc_item_id là bắt buộc" }, { status: 400 });
  if (!user_id) return NextResponse.json({ error: "user_id là bắt buộc" }, { status: 400 });

  const gate = await requireEditorByTocItemId(supabase, user!.id, toc_item_id);
  if (!gate.ok) return (gate as any).res;

  const { error: delErr } = await supabase
    .from("toc_assignments")
    .delete()
    .eq("toc_item_id", toc_item_id)
    .eq("user_id", user_id);

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
