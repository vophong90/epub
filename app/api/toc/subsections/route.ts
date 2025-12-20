// app/api/toc/subsections/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser, BookRole } from "../_helpers";

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

/**
 * Ensure slug unique within a book_version_id (safe default).
 * If your DB unique constraint is narrower (e.g., parent_id+slug) this still works.
 */
async function ensureUniqueSlug(
  supabase: any,
  bookVersionId: string,
  desiredSlug: string,
  excludeId?: string
) {
  const base = desiredSlug || `sub-${Date.now()}`;
  let slug = base;
  let i = 2;

  while (true) {
    let q = supabase
      .from("toc_items")
      .select("id")
      .eq("book_version_id", bookVersionId)
      .eq("slug", slug)
      .limit(1);

    if (excludeId) q = q.neq("id", excludeId);

    const { data, error } = await q.maybeSingle();
    if (error) throw error;

    if (!data) return slug;
    slug = `${base}-${i++}`;
    if (i > 200) return `${base}-${Date.now()}`;
  }
}

async function getParentContext(supabase: any, userId: string, parentId: string) {
  // TOC cha
  const { data: parent, error: pErr } = await supabase
    .from("toc_items")
    .select("id,book_version_id")
    .eq("id", parentId)
    .maybeSingle();

  if (pErr || !parent) {
    return {
      ok: false as const,
      res: NextResponse.json(
        { error: "Không tìm thấy mục cha (TOC parent)" },
        { status: 404 }
      ),
    };
  }

  // Version → book
  const { data: version, error: vErr } = await supabase
    .from("book_versions")
    .select("id,book_id")
    .eq("id", parent.book_version_id)
    .maybeSingle();

  if (vErr || !version?.book_id) {
    return {
      ok: false as const,
      res: NextResponse.json(
        { error: "Không tìm thấy phiên bản sách" },
        { status: 404 }
      ),
    };
  }

  // Quyền ở cấp sách
  const { data: perm, error: permErr } = await supabase
    .from("book_permissions")
    .select("role")
    .eq("book_id", version.book_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (permErr || !perm?.role) {
    return {
      ok: false as const,
      res: NextResponse.json(
        { error: "Bạn không có quyền với sách này" },
        { status: 403 }
      ),
    };
  }

  const bookRole = perm.role as BookRole;

  // Assignment với mục cha
  const { data: assignment } = await supabase
    .from("toc_assignments")
    .select("id,user_id,role_in_item")
    .eq("toc_item_id", parentId)
    .eq("user_id", userId)
    .maybeSingle();

  return {
    ok: true as const,
    parent,
    version,
    bookRole,
    assignment,
  };
}

function canManageSubsections(bookRole: BookRole, assignment: any | null) {
  if (bookRole === "editor") return true;
  if (
    bookRole === "author" &&
    assignment &&
    assignment.role_in_item === "author"
  ) {
    return true;
  }
  return false;
}

/** GET: danh sách mục con của 1 TOC item */
export async function GET(req: NextRequest) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const parent_id = searchParams.get("parent_id") || "";
  if (!parent_id) {
    return NextResponse.json({ error: "parent_id là bắt buộc" }, { status: 400 });
  }

  const ctx = await getParentContext(supabase, user!.id, parent_id);
  if (!ctx.ok) return ctx.res;

  const { parent } = ctx;

  const { data, error: listErr } = await supabase
    .from("toc_items")
    .select("id,parent_id,title,slug,order_index")
    .eq("book_version_id", parent.book_version_id)
    .eq("parent_id", parent.id)
    .order("order_index", { ascending: true });

  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, items: data ?? [] });
}

/** POST: tạo mục con mới */
export async function POST(req: NextRequest) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const parent_id = String(body.parent_id || "");
  const title = String(body.title || "").trim();

  if (!parent_id) {
    return NextResponse.json({ error: "parent_id là bắt buộc" }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: "title là bắt buộc" }, { status: 400 });
  }

  const ctx = await getParentContext(supabase, user!.id, parent_id);
  if (!ctx.ok) return ctx.res;

  const { parent, bookRole, assignment } = ctx;

  if (!canManageSubsections(bookRole, assignment)) {
    return NextResponse.json(
      { error: "Bạn không có quyền tạo mục con trong mục này." },
      { status: 403 }
    );
  }

  // order_index = max + 1 trong cùng parent
  const { data: maxRow } = await supabase
    .from("toc_items")
    .select("order_index")
    .eq("book_version_id", parent.book_version_id)
    .eq("parent_id", parent.id)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = (maxRow?.order_index ?? 0) + 1;

  // ✅ slug unique
  const desired = slugify(title) || `sub-${Date.now()}`;
  let slug: string;
  try {
    slug = await ensureUniqueSlug(supabase, parent.book_version_id, desired);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Không tạo được slug" },
      { status: 400 }
    );
  }

  const { data, error: insErr } = await supabase
    .from("toc_items")
    .insert({
      book_version_id: parent.book_version_id,
      parent_id: parent.id,
      title,
      slug,
      order_index: nextOrder,
    })
    .select("id,parent_id,title,slug,order_index")
    .maybeSingle();

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, item: data });
}

/** PATCH: đổi tên mục con */
export async function PATCH(req: NextRequest) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  const title = String(body.title || "").trim();

  if (!id) {
    return NextResponse.json({ error: "id là bắt buộc" }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: "title là bắt buộc" }, { status: 400 });
  }

  // Lấy mục con và parent
  const { data: sub, error: sErr } = await supabase
    .from("toc_items")
    .select("id,parent_id,book_version_id,slug,title")
    .eq("id", id)
    .maybeSingle();

  if (sErr || !sub || !sub.parent_id) {
    return NextResponse.json(
      { error: "Không tìm thấy mục con để sửa" },
      { status: 404 }
    );
  }

  const ctx = await getParentContext(supabase, user!.id, sub.parent_id);
  if (!ctx.ok) return ctx.res;

  const { bookRole, assignment } = ctx;
  if (!canManageSubsections(bookRole, assignment)) {
    return NextResponse.json(
      { error: "Bạn không có quyền sửa mục con này." },
      { status: 403 }
    );
  }

  const patch: any = { title };

  // ✅ Nếu client không gửi slug thì server tự sinh slug theo title (và đảm bảo unique)
  // Nếu bạn muốn đổi title nhưng GIỮ nguyên slug → hãy gửi body.slug = sub.slug từ client.
  if (!body.slug) {
    const desired = slugify(title);
    try {
      patch.slug = await ensureUniqueSlug(
        supabase,
        sub.book_version_id,
        desired,
        id // exclude chính nó
      );
    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message || "Không cập nhật được slug" },
        { status: 400 }
      );
    }
  } else if (typeof body.slug === "string") {
    // nếu client muốn set slug cụ thể thì vẫn cho, nhưng đảm bảo unique
    const desired = slugify(String(body.slug));
    try {
      patch.slug = await ensureUniqueSlug(
        supabase,
        sub.book_version_id,
        desired,
        id
      );
    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message || "Không cập nhật được slug" },
        { status: 400 }
      );
    }
  }

  const { data, error: upErr } = await supabase
    .from("toc_items")
    .update(patch)
    .eq("id", id)
    .select("id,parent_id,title,slug,order_index")
    .maybeSingle();

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, item: data });
}

/** DELETE: xoá mục con */
export async function DELETE(req: NextRequest) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id") || "";
  if (!id) {
    return NextResponse.json({ error: "id là bắt buộc" }, { status: 400 });
  }

  const { data: sub, error: sErr } = await supabase
    .from("toc_items")
    .select("id,parent_id,book_version_id,title")
    .eq("id", id)
    .maybeSingle();

  if (sErr || !sub || !sub.parent_id) {
    return NextResponse.json(
      { error: "Không tìm thấy mục con để xoá" },
      { status: 404 }
    );
  }

  const ctx = await getParentContext(supabase, user!.id, sub.parent_id);
  if (!ctx.ok) return ctx.res;

  const { bookRole, assignment } = ctx;
  if (!canManageSubsections(bookRole, assignment)) {
    return NextResponse.json(
      { error: "Bạn không có quyền xoá mục con này." },
      { status: 403 }
    );
  }

  const { error: delErr } = await supabase.from("toc_items").delete().eq("id", id);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
