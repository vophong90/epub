// app/api/toc/items/reorder/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  book_version_id?: string;
  parent_id?: string | null;
  ordered_ids?: string[];
};

async function requireEditorByVersionId(
  supabase: any,
  userId: string,
  versionId: string
) {
  const { data: version, error: vErr } = await supabase
    .from("book_versions")
    .select("id,book_id")
    .eq("id", versionId)
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
        { error: "Chỉ editor mới được sửa TOC" },
        { status: 403 }
      ),
    };
  }

  return { ok: true };
}

export async function POST(req: NextRequest) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const book_version_id = String(body.book_version_id || "");
  const parent_id = body.parent_id ? String(body.parent_id) : null;
  const ordered_ids = Array.isArray(body.ordered_ids)
    ? body.ordered_ids.map(String)
    : [];

  if (!book_version_id) {
    return NextResponse.json(
      { error: "book_version_id là bắt buộc" },
      { status: 400 }
    );
  }

  if (!ordered_ids.length) {
    return NextResponse.json(
      { error: "ordered_ids[] là bắt buộc" },
      { status: 400 }
    );
  }

  const gate = await requireEditorByVersionId(
    supabase,
    user!.id,
    book_version_id
  );
  if (!gate.ok) return (gate as any).res;

  // ⚡ Gọi RPC để reorder 1 lần cho toàn bộ danh sách
  const { error: rpcErr } = await supabase.rpc("reorder_toc_items", {
    p_book_version_id: book_version_id,
    p_parent_id: parent_id,
    p_ordered_ids: ordered_ids,
  });

  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
