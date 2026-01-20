// app/api/toc/item/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../_helpers";
import { getAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TocKind = "section" | "chapter" | "heading";

type TocItemRow = {
  id: string;
  book_version_id: string;
  parent_id: string | null;
  title: string;
  slug: string;
  order_index: number;
  kind: TocKind; // ✅ NEW
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

/** Chuẩn hóa giá trị uuid có thể bị gửi là "null" / "" / undefined */
function normalizeUuidish(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === "null") return null;
  return s;
}

/** Chuẩn hóa kind */
function normalizeKind(v: unknown): TocKind | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (s === "section" || s === "chapter" || s === "heading") return s;
  return null;
}

async function requireEditorByVersionId(
  supabase: any,
  userId: string,
  versionId: string
) {
  const safeVersionId = normalizeUuidish(versionId);
  if (!safeVersionId) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "version_id không hợp lệ" },
        { status: 400 }
      ),
    };
  }

  const { data: version, error: vErr } = await supabase
    .from("book_versions")
    .select("id,book_id")
    .eq("id", safeVersionId)
    .maybeSingle();

  const v = version as Pick<VersionRow, "id" | "book_id"> | null;

  if (vErr || !v?.book_id) {
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
    .eq("book_id", v.book_id)
    .eq("user_id", userId)
    .maybeSingle();

  const p = perm as { role: "viewer" | "author" | "editor" } | null;

  if (pErr || !p?.role || p.role !== "editor") {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "Chỉ editor mới được sửa TOC" },
        { status: 403 }
      ),
    };
  }

  return { ok: true, book_id: v.book_id };
}

/** Lấy order_index tiếp theo trong cùng parent */
async function getNextOrderIndex(
  supabase: any,
  book_version_id: string,
  parent_id: string | null
) {
  let query = supabase
    .from("toc_items")
    .select("order_index")
    .eq("book_version_id", book_version_id)
    .order("order_index", { ascending: false })
    .limit(1);

  if (parent_id === null) query = query.is("parent_id", null);
  else query = query.eq("parent_id", parent_id);

  const { data: last, error: lastErr } = await query.maybeSingle();
  const lastRow = last as { order_index: number } | null;

  if (lastErr) {
    throw new Error(lastErr.message);
  }
  return (lastRow?.order_index ?? 0) + 1;
}

// ===== GET: lấy chi tiết 1 TOC item (đang dùng cho openEditModal) =====

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tocItemIdRaw = searchParams.get("toc_item_id");
  const tocItemId = normalizeUuidish(tocItemIdRaw);

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
    .select("id,book_version_id,parent_id,title,slug,order_index,kind") // ✅ kind
    .eq("id", tocItemId)
    .maybeSingle();

  const tocItem = item as TocItemRow | null;

  if (iErr || !tocItem) {
    return NextResponse.json(
      { error: "Không tìm thấy TOC item" },
      { status: 404 }
    );
  }

  // 2) Version -> book_id + template_id (logic mới)
  const { data: version, error: vErr } = await supabase
    .from("book_versions")
    .select("id,book_id,template_id")
    .eq("id", tocItem.book_version_id)
    .maybeSingle();

  const v = version as VersionRow | null;

  if (vErr || !v?.book_id) {
    return NextResponse.json(
      { error: "Không tìm thấy phiên bản sách" },
      { status: 404 }
    );
  }

  // 3) Quyền ở cấp sách (viewer/author/editor đều xem được)
  const { data: perm, error: pErr } = await supabase
    .from("book_permissions")
    .select("role")
    .eq("book_id", v.book_id)
    .eq("user_id", user!.id)
    .maybeSingle();

  const p = perm as { role: "viewer" | "author" | "editor" } | null;

  if (pErr || !p?.role) {
    return NextResponse.json(
      { error: "Bạn không có quyền truy cập" },
      { status: 403 }
    );
  }

  // 4) Lấy tên sách
  const { data: book, error: bErr } = await supabase
    .from("books")
    .select("id,title")
    .eq("id", v.book_id)
    .maybeSingle();

  const b = book as { id: string; title: string } | null;

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
    .maybeSingle();

  const c = content as TocContentRow | null;

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
    item: tocItem,
    role: p.role,
    book_id: v.book_id,
    book_title: b?.title ?? null,
    content: c ?? null,
    assignments: assignmentsWithProfiles,
    // ✅ logic mới: trả thêm template_id của version
    version_template_id: v.template_id,
  });
}

// ===== POST: create TOC item (UI: handleSaveToc, modalMode === "create") =====

type CreateBody = {
  book_version_id?: string;
  parent_id?: string | null;
  title?: string;
  kind?: TocKind; // ✅ NEW
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

  const book_version_id = normalizeUuidish(body.book_version_id);
  const parent_id = normalizeUuidish(body.parent_id ?? null);
  const title = String(body.title || "").trim();
  const kind = normalizeKind(body.kind) ?? "chapter"; // ✅ default

  if (!book_version_id) {
    return NextResponse.json(
      { error: "book_version_id là bắt buộc" },
      { status: 400 }
    );
  }
  if (!title) {
    return NextResponse.json({ error: "title là bắt buộc" }, { status: 400 });
  }

  const gate = await requireEditorByVersionId(
    supabase,
    user!.id,
    book_version_id
  );
  if (!gate.ok) return (gate as any).res;

  // ✅ Rule: section chỉ được nằm ở root
  if (kind === "section" && parent_id !== null) {
    return NextResponse.json(
      { error: "Section chỉ được tạo ở cấp root (parent_id = null)" },
      { status: 400 }
    );
  }

  // ✅ Rule: nếu parent_id != null thì parent phải là section hoặc chapter/heading (tuỳ bạn)
  // Theo flow mới: chapter trong section => parent là section
  if (parent_id !== null) {
    const { data: parent, error: pErr } = await supabase
      .from("toc_items")
      .select("id,kind,book_version_id")
      .eq("id", parent_id)
      .maybeSingle();

    const pr = parent as { id: string; kind: TocKind; book_version_id: string } | null;
    if (pErr || !pr?.id) {
      return NextResponse.json(
        { error: "parent_id không tồn tại" },
        { status: 400 }
      );
    }
    if (pr.book_version_id !== book_version_id) {
      return NextResponse.json(
        { error: "parent_id không thuộc cùng book_version" },
        { status: 400 }
      );
    }

    // Chapter đưa vào section (cấp 1) => parent phải là section
    if (kind === "chapter" && pr.kind !== "section") {
      return NextResponse.json(
        { error: "Chương cấp 1 chỉ được đặt dưới Section hoặc ở root" },
        { status: 400 }
      );
    }
  }

  // Lấy order_index tiếp theo trong cùng parent
  let nextOrder = 1;
  try {
    nextOrder = await getNextOrderIndex(supabase, book_version_id, parent_id);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Lỗi order_index" }, { status: 400 });
  }

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
      kind, // ✅ NEW
    })
    .select("id,book_version_id,parent_id,title,slug,order_index,kind")
    .single();

  const newItem = inserted as TocItemRow | null;

  if (insErr || !newItem) {
    return NextResponse.json(
      { error: insErr?.message || "Không tạo được TOC item" },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, item: newItem });
}

// ===== PATCH: update TOC item (title và/hoặc move parent_id) =====

type PatchBody = {
  id?: string;
  title?: string;
  parent_id?: string | null; // ✅ NEW (move)
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

  const id = normalizeUuidish(body.id);
  const titleRaw = body.title;
  const title = titleRaw === undefined ? undefined : String(titleRaw || "").trim();
  const new_parent_id = body.parent_id === undefined ? undefined : normalizeUuidish(body.parent_id);

  if (!id) {
    return NextResponse.json({ error: "id là bắt buộc" }, { status: 400 });
  }

  // Lấy item để biết book_version_id + kind + parent_id hiện tại
  const { data: item, error: iErr } = await supabase
    .from("toc_items")
    .select("id,book_version_id,kind,parent_id")
    .eq("id", id)
    .maybeSingle();

  const row = item as { id: string; book_version_id: string; kind: TocKind; parent_id: string | null } | null;

  if (iErr || !row?.book_version_id) {
    return NextResponse.json(
      { error: "Không tìm thấy TOC item" },
      { status: 404 }
    );
  }

  const gate = await requireEditorByVersionId(
    supabase,
    user!.id,
    row.book_version_id
  );
  if (!gate.ok) return (gate as any).res;

  const updatePayload: any = {};

  // 1) Update title (nếu có)
  if (title !== undefined) {
    if (!title) {
      return NextResponse.json(
        { error: "title là bắt buộc" },
        { status: 400 }
      );
    }
    updatePayload.title = title;
  }

  // 2) Move parent_id (nếu có)
  if (new_parent_id !== undefined) {
    // ✅ section chỉ root (không được move section vào đâu)
    if (row.kind === "section") {
      if (new_parent_id !== null) {
        return NextResponse.json(
          { error: "Section không được có parent_id" },
          { status: 400 }
        );
      }
      // nếu gửi parent_id=null cho section thì ignore (không đổi)
    } else {
      // ✅ chỉ cho move "chapter" cấp 1 (root chapter) vào section hoặc ra root
      if (row.kind !== "chapter") {
        return NextResponse.json(
          { error: "Chỉ chương cấp 1 (kind=chapter) mới được chuyển Section" },
          { status: 400 }
        );
      }

      // Nếu đưa vào 1 section: parent phải là section
      if (new_parent_id !== null) {
        const { data: parent, error: pErr } = await supabase
          .from("toc_items")
          .select("id,kind,book_version_id")
          .eq("id", new_parent_id)
          .maybeSingle();

        const pr = parent as { id: string; kind: TocKind; book_version_id: string } | null;

        if (pErr || !pr?.id) {
          return NextResponse.json(
            { error: "Section không tồn tại" },
            { status: 400 }
          );
        }
        if (pr.book_version_id !== row.book_version_id) {
          return NextResponse.json(
            { error: "Section không thuộc cùng book_version" },
            { status: 400 }
          );
        }
        if (pr.kind !== "section") {
          return NextResponse.json(
            { error: "parent_id phải trỏ tới một Section (kind=section)" },
            { status: 400 }
          );
        }
      }

      // Tính order_index mới ở "nhà mới" (đưa vào cuối)
      let nextOrder = 1;
      try {
        nextOrder = await getNextOrderIndex(
          supabase,
          row.book_version_id,
          new_parent_id ?? null
        );
      } catch (e: any) {
        return NextResponse.json(
          { error: e?.message || "Lỗi order_index khi move" },
          { status: 400 }
        );
      }

      updatePayload.parent_id = new_parent_id ?? null;
      updatePayload.order_index = nextOrder;
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json({ ok: true }); // nothing to update
  }

  const { error: upErr } = await supabase
    .from("toc_items")
    .update(updatePayload)
    .eq("id", id);

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 400 });
  }

  // Trả lại row mới để UI dễ sync (tuỳ bạn dùng)
  const { data: updated, error: uErr } = await supabase
    .from("toc_items")
    .select("id,book_version_id,parent_id,title,slug,order_index,kind")
    .eq("id", id)
    .maybeSingle();

  if (uErr) {
    return NextResponse.json({ ok: true }); // vẫn ok, chỉ không trả item
  }

  return NextResponse.json({ ok: true, item: updated });
}

// ===== DELETE: xoá TOC item =====

export async function DELETE(req: NextRequest) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const id = normalizeUuidish(searchParams.get("id"));

  if (!id) {
    return NextResponse.json({ error: "id là bắt buộc" }, { status: 400 });
  }

  const { data: item, error: iErr } = await supabase
    .from("toc_items")
    .select("id,book_version_id")
    .eq("id", id)
    .maybeSingle();

  const row = item as { id: string; book_version_id: string } | null;

  if (iErr || !row?.book_version_id) {
    return NextResponse.json(
      { error: "Không tìm thấy TOC item" },
      { status: 404 }
    );
  }

  const gate = await requireEditorByVersionId(
    supabase,
    user!.id,
    row.book_version_id
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
