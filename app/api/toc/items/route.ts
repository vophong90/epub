import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

async function requireEditorByVersionId(supabase: any, userId: string, versionId: string) {
  const { data: version, error: vErr } = await supabase
    .from("book_versions")
    .select("id,book_id")
    .eq("id", versionId)
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
    return { ok: false, res: NextResponse.json({ error: "Chỉ editor mới được sửa TOC" }, { status: 403 }) };
  }

  return { ok: true, book_id: version.book_id as string };
}

export async function POST(req: NextRequest) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const book_version_id = String(body.book_version_id || "");
  const parent_id = body.parent_id ? String(body.parent_id) : null;
  const title = String(body.title || "").trim();
  const slug = String(body.slug || "").trim();
  const order_index = Number.isFinite(body.order_index) ? Number(body.order_index) : null;

  if (!book_version_id) return NextResponse.json({ error: "book_version_id là bắt buộc" }, { status: 400 });
  if (!title) return NextResponse.json({ error: "title là bắt buộc" }, { status: 400 });

  const gate = await requireEditorByVersionId(supabase, user!.id, book_version_id);
  if (!gate.ok) return (gate as any).res;

  const finalSlug = slug || slugify(title) || `item-${Date.now()}`;

  // Default order_index: append to end (max + 1) within same parent
  let finalOrder = order_index;
  if (!finalOrder) {
    const { data: maxRow } = await supabase
      .from("toc_items")
      .select("order_index")
      .eq("book_version_id", book_version_id)
      .is("parent_id", parent_id)
      .order("order_index", { ascending: false })
      .limit(1)
      .maybeSingle();
    finalOrder = (maxRow?.order_index ?? 0) + 1;
  }

  const { data, error: insErr } = await supabase
    .from("toc_items")
    .insert({
      book_version_id,
      parent_id,
      title,
      slug: finalSlug,
      order_index: finalOrder,
    })
    .select("id,parent_id,title,slug,order_index")
    .maybeSingle();

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });
  return NextResponse.json({ ok: true, item: data });
}

export async function PATCH(req: NextRequest) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "id là bắt buộc" }, { status: 400 });

  // Load item to know version
  const { data: item, error: iErr } = await supabase
    .from("toc_items")
    .select("id,book_version_id,parent_id")
    .eq("id", id)
    .maybeSingle();
  if (iErr || !item) return NextResponse.json({ error: "Không tìm thấy TOC item" }, { status: 404 });

  const gate = await requireEditorByVersionId(supabase, user!.id, item.book_version_id);
  if (!gate.ok) return (gate as any).res;

  const patch: any = {};
  if (body.title !== undefined) patch.title = String(body.title || "").trim();
  if (body.slug !== undefined) patch.slug = String(body.slug || "").trim();
  if (body.parent_id !== undefined) patch.parent_id = body.parent_id ? String(body.parent_id) : null;
  if (body.order_index !== undefined) patch.order_index = Number(body.order_index);

  if (!Object.keys(patch).length) {
    return NextResponse.json({ ok: true });
  }

  // Auto slug if title changed and slug missing
  if (patch.title && !patch.slug) patch.slug = slugify(patch.title);

  const { data, error: upErr } = await supabase
    .from("toc_items")
    .update(patch)
    .eq("id", id)
    .select("id,parent_id,title,slug,order_index")
    .maybeSingle();

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });
  return NextResponse.json({ ok: true, item: data });
}

export async function DELETE(req: NextRequest) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "id là bắt buộc" }, { status: 400 });

  const { data: item, error: iErr } = await supabase
    .from("toc_items")
    .select("id,book_version_id")
    .eq("id", id)
    .maybeSingle();
  if (iErr || !item) return NextResponse.json({ error: "Không tìm thấy TOC item" }, { status: 404 });

  const gate = await requireEditorByVersionId(supabase, user!.id, item.book_version_id);
  if (!gate.ok) return (gate as any).res;

  const { error: delErr } = await supabase.from("toc_items").delete().eq("id", id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
