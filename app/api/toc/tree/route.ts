import { NextRequest, NextResponse } from "next/server";
import { getBookContextByVersionId } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const versionId = searchParams.get("version_id") || "";
  if (!versionId) return NextResponse.json({ error: "version_id là bắt buộc" }, { status: 400 });

  const ctx = await getBookContextByVersionId(versionId);
  if (ctx.error) return ctx.error;

  const { supabase, role, book_id } = ctx;

  const { data, error } = await supabase
    .from("toc_items")
    .select("id,parent_id,title,slug,order_index,created_at")
    .eq("book_version_id", versionId)
    .order("order_index", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    version_id: versionId,
    book_id,
    role,
    items: data ?? [],
  });
}
