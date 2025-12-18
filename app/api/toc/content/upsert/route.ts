import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  toc_item_id?: string;
  content_json?: any;
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
  if (!tocItemId) return NextResponse.json({ error: "toc_item_id là bắt buộc" }, { status: 400 });

  const contentJson = body.content_json ?? null;
  if (contentJson === null) {
    return NextResponse.json({ error: "content_json là bắt buộc" }, { status: 400 });
  }

  // Upsert: requires INSERT policy for first save and UPDATE policy for subsequent saves.
  const { data, error: upErr } = await supabase
    .from("toc_contents")
    .upsert({ toc_item_id: tocItemId, content_json: contentJson, updated_by: user!.id })
    .select("toc_item_id,updated_at,updated_by")
    .maybeSingle();

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 403 });
  }

  return NextResponse.json({ ok: true, content: data });
}
