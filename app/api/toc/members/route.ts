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

  const { supabase, book_id } = ctx;

  // Only members of this book
  const { data, error } = await supabase
    .from("book_permissions")
    .select("user_id, role, profiles:profiles(id,name,email)")
    .eq("book_id", book_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const members = (data ?? []).map((row: any) => ({
    user_id: row.user_id,
    role: row.role,
    profile: row.profiles,
  }));

  return NextResponse.json({ ok: true, book_id, members });
}
