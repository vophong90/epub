// app/api/toc/item/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../_helpers";
import { getAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TocItemRow = {
  id: string;
  book_version_id: string;
  parent_id: string | null;
  title: string;
  slug: string;
  order_index: number;
};

type TocContentRow = {
  toc_item_id: string;
  content_json: any;
  updated_at: string | null;
  updated_by: string | null;
  status: "draft" | "submitted" | "needs_revision" | "approved";
  editor_note: string | null;
  author_resolved: boolean;
};

type AssignmentRow = {
  id: string;
  toc_item_id: string;
  user_id: string;
  role_in_item: "author" | "editor";
};

type ProfileRow = {
  id: string;
  name: string | null;
  email: string | null;
};

// thêm kiểu cho version để có template_id
type VersionRow = {
  id: string;
  book_id: string;
  template_id: string | null;
};

// ===== Helpers dùng cho POST/PATCH/DELETE =====

function slugify(input: string) {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function requireEditorByVersionId(
  supabase: any,
  userId: string,
  versionId: string
) {
  const { data: version, error: vErr } = await supabase
    .from("book_versions")
    .select("id,book_id")
    .eq("id", versionId)
    .maybeSingle<Pick<VersionRow, "id" | "book_id">>();

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
    .maybeSingle<{ role: "viewer" | "author" | "editor" }>();

  if (pErr || !perm?.role || perm.role !== "editor") {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "Chỉ editor mới được sửa TOC" },
        { status: 403 }
      ),
    };
  }

  return { ok: true, book_id: version.book_id };
}

// ===== GET: lấy chi tiết 1 TOC item (đang dùng cho openEditModal) =====

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tocItemId = searchParams.get("toc_item_id") || "";
  if (!tocItemId) {
    return NextResponse.json(
      { error: "toc_item_id là bắt buộc" },
      { status: 400 }
    );
  }

  const { supabase, user, error } = await requireUser();
  if (error) return error;

  // 1) TOC item
  const { data: item, error: iErr } = await supabase
    .from("toc_items")
    .select("id,book_version_id,parent_id,title,slug,order_index")
    .eq("id", tocItemId)
    .maybeSingle<TocItemRow>();

  if (iErr || !item) {
    return NextResponse.json(
      { error: "Không tìm thấy TOC item" },
      { status: 404 }
    );
  }

  // 2) Version -> book_id + template_id (logic mới)
  const { data: version, error: vErr } = await supabase
    .from("book_versions")
    .select("id,book_id,template_id")
    .eq("id", item.book_version_id)
    .maybeSingle<VersionRow>();

  if (vErr || !version?.book_id) {
    return NextResponse.json(
      { error: "Không tìm thấy phiên bản sách" },
      { status: 404 }
    );
  }

  // 3) Quyền ở cấp sách (viewer/author/editor đều xem được)
  const { data: perm, error: pErr } = await supabase
    .from("book_permissions")
    .select("role")
    .eq("book_id", version.book_id)
    .eq("user_id", user!.id)
    .maybeSingle<{ role: "viewer" | "author" | "editor" }>();

  if (pErr || !perm?.role) {
    return NextResponse.json(
      { error: "Bạn không có quyền truy cập" },
      { status: 403 }
    );
  }

  // 4) Lấy tên sách
  const { data: book, error: bErr } = await supabase
    .from("books")
    .select("id,title")
    .eq("id", version.book_id)
    .maybeSingle<{ id: string; title: string }>();

  if (bErr) {
    console.error("books select error in /api/toc/item:", bErr);
  }

  // 5) Nội dung mục
  const { data: content, error: cErr } = await supabase
    .from("toc_contents")
    .select(
      "toc_item_id,content_json,updated_at,updated_by,status,editor_note,author_resolved"
    )
    .eq("toc_item_id", tocItemId)
    .maybeSingle<TocContentRow>();

  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }

  // 6) Assignments
  const { data: assigns, error: aErr } = (await supabase
    .from("toc_assignments")
    .select("id,toc_item_id,user_id,role_in_item")
    .eq("toc_item_id", tocItemId)) as {
    data: AssignmentRow[] | null;
    error: any;
  };

  if (aErr) {
    return NextResponse.json({ error: aErr.message }, { status: 500 });
  }

  let assignmentsWithProfiles: (AssignmentRow & {
    profile?: ProfileRow | null;
  })[] = assigns ?? [];

  // 7) Gắn profile bằng admin client
  if (assignmentsWithProfiles.length > 0) {
    try {
      const admin = getAdminClient();
      const userIds = Array.from(
        new Set(assignmentsWithProfiles.map((a) => a.user_id))
      );

      const { data: profiles, error: prErr } = (await admin
        .from("profiles")
        .select("id,name,email")
        .in("id", userIds)) as {
        data: ProfileRow[] | null;
        error: any;
      };

      if (prErr) {
        console.error("profiles select error in /api/toc/item:", prErr);
      } else if (profiles) {
        const map = new Map<string, ProfileRow>();
        for (const p of profiles) {
          map.set(p.id, p);
        }
        assignmentsWithProfiles = assignmentsWithProfiles.map((a) => ({
          ...a,
          profile: map.get(a.user_id) ?? null,
        }));
      }
    } catch (e) {
      console.error("getAdminClient/profiles error:", e);
    }
  }

  return NextResponse.json({
    item,
    role: perm.role,
    book_id: version.book_id,
    book_title: book?.title ?? null,
    content: content ?? null,
    assignments: assignmentsWithProfiles,
    // ✅ logic mới: trả thêm template_id của version
    version_template_id: version.template_id,
  });
}

// ===== POST: create TOC item (UI: handleSaveToc, modalMode === "create") =====

type CreateBody = {
  book_version_id?: string;
  parent_id?: string | null;
  title?: string;
};

export async function POST(req: NextRequest) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  let body: CreateBody = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const book_version_id = String(body.book_version_id || "");
  const parent_id = body.parent_id ? String(body.parent_id) : null;
  const title = String(body.title || "").trim();

  if (!book_version_id) {
    return NextResponse.json(
      { error: "book_version_id là bắt buộc" },
      { status: 400 }
    );
  }
  if (!title) {
    return NextResponse.json(
      { error: "title là bắt buộc" },
      { status: 400 }
    );
  }

  const gate = await requireEditorByVersionId(
    supabase,
    user!.id,
    book_version_id
  );
  if (!gate.ok) return (gate as any).res;

  // Lấy order_index tiếp theo trong cùng parent
  const { data: last, error: lastErr } = await supabase
    .from("toc_items")
    .select("order_index")
    .eq("book_version_id", book_version_id)
    .eq("parent_id", parent_id)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle<{ order_index: number }>();

  if (lastErr) {
    return NextResponse.json({ error: lastErr.message }, { status: 400 });
  }

  const nextOrder = (last?.order_index ?? 0) + 1;

  const baseSlug = slugify(title) || "muc-luc";
  const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;

  const { data: inserted, error: insErr } = await supabase
    .from("toc_items")
    .insert({
      book_version_id,
      parent_id,
      title,
      slug,
      order_index: nextOrder,
    })
    .select("id,book_version_id,parent_id,title,slug,order_index")
    .single<TocItemRow>();

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, item: inserted });
}

// ===== PATCH: update TOC item title (UI: handleSaveToc, modalMode === "edit") =====

type PatchBody = {
  id?: string;
  title?: string;
};

export async function PATCH(req: NextRequest) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  let body: PatchBody = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const id = String(body.id || "");
  const title = String(body.title || "").trim();

  if (!id) {
    return NextResponse.json({ error: "id là bắt buộc" }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json(
      { error: "title là bắt buộc" },
      { status: 400 }
    );
  }

  // Lấy item để biết book_version_id cho check quyền
  const { data: item, error: iErr } = await supabase
    .from("toc_items")
    .select("id,book_version_id")
    .eq("id", id)
    .maybeSingle<{ id: string; book_version_id: string }>();

  if (iErr || !item?.book_version_id) {
    return NextResponse.json(
      { error: "Không tìm thấy TOC item" },
      { status: 404 }
    );
  }

  const gate = await requireEditorByVersionId(
    supabase,
    user!.id,
    item.book_version_id
  );
  if (!gate.ok) return (gate as any).res;

  const { error: upErr } = await supabase
    .from("toc_items")
    .update({
      title,
      // nếu muốn slug đổi theo title thì có thể bật lại:
      // slug: `${slugify(title) || "muc-luc"}-${id.slice(0, 4)}`,
    })
    .eq("id", id);

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

// ===== DELETE: xoá TOC item (UI: handleDeleteToc gọi /api/toc/item?id=...) =====

export async function DELETE(req: NextRequest) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id") || "";
  if (!id) {
    return NextResponse.json({ error: "id là bắt buộc" }, { status: 400 });
  }

  const { data: item, error: iErr } = await supabase
    .from("toc_items")
    .select("id,book_version_id")
    .eq("id", id)
    .maybeSingle<{ id: string; book_version_id: string }>();

  if (iErr || !item?.book_version_id) {
    return NextResponse.json(
      { error: "Không tìm thấy TOC item" },
      { status: 404 }
    );
  }

  const gate = await requireEditorByVersionId(
    supabase,
    user!.id,
    item.book_version_id
  );
  if (!gate.ok) return (gate as any).res;

  const { error: delErr } = await supabase
    .from("toc_items")
    .delete()
    .eq("id", id);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
