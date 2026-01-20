// app/api/books/version/clone/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRouteClient } from "@/lib/supabaseServer";
import { getAdminClient } from "@/lib/supabase-admin";

async function fetchAllTocItemsByVersion(supabase: any, sourceVersionId: string) {
  const PAGE = 1000;
  let from = 0;
  const all: any[] = [];

  while (true) {
    const { data, error } = await supabase
      .from("toc_items")
      .select("id, book_version_id, parent_id, title, slug, kind, order_index, created_at")
      .eq("book_version_id", sourceVersionId)
      .order("order_index", { ascending: true })
      .order("id", { ascending: true }) // stable paging
      .range(from, from + PAGE - 1);

    if (error) throw new Error(`Lỗi khi đọc TOC của phiên bản nguồn: ${error.message}`);

    const batch = data || [];
    all.push(...batch);

    if (batch.length < PAGE) break;
    from += PAGE;
  }

  return all;
}

/**
 * Fetch rows from a table by chunked IN(ids) + pagination.
 * - Avoids 1000 row cap and overly-large IN list.
 */
async function fetchAllByItemIds<T>(
  supabase: any,
  table: "toc_contents" | "toc_assignments",
  selectCols: string,
  idCol: string, // "toc_item_id"
  tocItemIds: string[]
): Promise<T[]> {
  if (!tocItemIds.length) return [];

  const ID_CHUNK = 500; // safe for IN list
  const PAGE = 1000;

  const all: T[] = [];

  for (let i = 0; i < tocItemIds.length; i += ID_CHUNK) {
    const slice = tocItemIds.slice(i, i + ID_CHUNK);

    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from(table)
        .select(selectCols)
        .in(idCol, slice)
        .order(idCol, { ascending: true })
        .range(from, from + PAGE - 1);

      if (error) {
        const label = table === "toc_contents" ? "nội dung TOC" : "phân công TOC";
        throw new Error(`Lỗi khi lấy ${label}: ${error.message}`);
      }

      const batch = (data || []) as T[];
      all.push(...batch);

      if (batch.length < PAGE) break;
      from += PAGE;
    }
  }

  return all;
}

export async function POST(req: NextRequest) {
  // ✅ route client: check user/permission (cookie session)
  const supabase = getRouteClient();
  // ✅ admin client: thực hiện clone (service role)
  const admin = getAdminClient();

  // 0) Parse body
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const book_id_input = (body.book_id as string | undefined) || undefined;
  const source_version_id_input =
    (body.source_version_id as string | undefined) || undefined;

  if (!book_id_input && !source_version_id_input) {
    return NextResponse.json(
      { ok: false, error: "Cần truyền book_id hoặc source_version_id." },
      { status: 400 }
    );
  }

  // 1) Check user login
  const {
    data: { user },
    error: uErr,
  } = await supabase.auth.getUser();

  if (uErr || !user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 2) Xác định source version (dùng admin để chắc chắn đọc được)
    type VersionRow = {
      id: string;
      book_id: string;
      version_no: number;
      status: string;
      created_by: string | null;
      created_at: string | null;
      template_id: string | null;
    };

    let sourceVersion: VersionRow | null = null;

    if (source_version_id_input) {
      const { data, error } = await admin
        .from("book_versions")
        .select("id, book_id, version_no, status, created_by, created_at, template_id")
        .eq("id", source_version_id_input)
        .maybeSingle();

      if (error || !data) {
        return NextResponse.json({ ok: false, error: "Không tìm thấy version nguồn." }, { status: 404 });
      }

      if (data.status !== "published") {
        return NextResponse.json({ ok: false, error: "Chỉ được clone từ version đã publish." }, { status: 400 });
      }

      sourceVersion = data as VersionRow;
    } else {
      const { data, error } = await admin
        .from("book_versions")
        .select("id, book_id, version_no, status, created_by, created_at, template_id")
        .eq("book_id", book_id_input!)
        .eq("status", "published")
        .order("version_no", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        return NextResponse.json(
          { ok: false, error: "Không tìm thấy phiên bản published nào của sách này để clone." },
          { status: 404 }
        );
      }

      sourceVersion = data as VersionRow;
    }

    if (!sourceVersion) {
      return NextResponse.json({ ok: false, error: "Không xác định được phiên bản nguồn." }, { status: 500 });
    }

    const bookId = sourceVersion.book_id;

    // 3) Check quyền user trên book (dùng route client để tôn trọng RLS)
    const { data: profile, error: pErr } = await supabase
      .from("profiles")
      .select("id,system_role")
      .eq("id", user.id)
      .maybeSingle();

    if (pErr) {
      return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 });
    }

    const isAdmin = profile?.system_role === "admin";

    const { data: perm, error: permErr } = await supabase
      .from("book_permissions")
      .select("role")
      .eq("book_id", bookId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (permErr) {
      return NextResponse.json({ ok: false, error: permErr.message }, { status: 500 });
    }

    if (!perm && !isAdmin) {
      return NextResponse.json({ ok: false, error: "Bạn không có quyền tạo phiên bản cho sách này" }, { status: 403 });
    }

    // 4) Tìm version_no lớn nhất hiện có để +1
    const { data: maxVersionRow, error: maxErr } = await admin
      .from("book_versions")
      .select("version_no")
      .eq("book_id", bookId)
      .order("version_no", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (maxErr) {
      return NextResponse.json(
        { ok: false, error: `Lỗi khi kiểm tra version hiện có: ${maxErr.message}` },
        { status: 500 }
      );
    }

    const nextVersionNo =
      (maxVersionRow?.version_no ?? sourceVersion.version_no ?? 0) + 1;

    // 5) Tạo version mới (draft) + ✅ inherit template_id + ✅ created_by = user.id
    const { data: insertedVersion, error: insVersionErr } = await admin
      .from("book_versions")
      .insert({
        book_id: bookId,
        version_no: nextVersionNo,
        status: "draft",
        created_by: user.id,
        template_id: sourceVersion.template_id ?? null,
      })
      .select("id, book_id, version_no, status, created_by, created_at, template_id")
      .maybeSingle();

    if (insVersionErr || !insertedVersion) {
      return NextResponse.json(
        { ok: false, error: insVersionErr?.message || "Không tạo được phiên bản nháp mới từ version publish." },
        { status: 500 }
      );
    }

    const newVersion = insertedVersion as VersionRow;
    const newVersionId = newVersion.id;

    // 6) Lấy toàn bộ TOC items của sourceVersion (FIX: pagination)
    type TocItemRow = {
      id: string;
      book_version_id: string;
      parent_id: string | null;
      title: string;
      slug: string | null;
      kind: string | null;
      order_index: number;
      created_at: string | null;
    };

    const allItems = (await fetchAllTocItemsByVersion(admin, sourceVersion.id)) as TocItemRow[];

    // Nếu không có TOC thì trả về version mới
    if (allItems.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "Tạo phiên bản nháp mới thành công (không có TOC để clone).",
        new_version: newVersion,
      });
    }

    // 7) Group theo parent để clone theo tree
    const childrenMap = new Map<string | null, TocItemRow[]>();
    for (const it of allItems) {
      const key = it.parent_id;
      if (!childrenMap.has(key)) childrenMap.set(key, []);
      childrenMap.get(key)!.push(it);
    }

    // helper: lấy children của một item
    const getChildren = (parentId: string | null) => childrenMap.get(parentId) || [];

    // 8) Load contents & assignments 1 lần (chunk+pagination)
    type TocContentRow = {
      toc_item_id: string;
      content_json: any;
      status: string;
      updated_by: string | null;
      updated_at: string | null;
    };

    type TocAssignmentRow = {
      toc_item_id: string;
      user_id: string;
      role_in_item: string;
    };

    const sourceItemIds = allItems.map((i) => i.id);

    const allContents = await fetchAllByItemIds<TocContentRow>(
      admin,
      "toc_contents",
      "toc_item_id, content_json, status, updated_by, updated_at",
      "toc_item_id",
      sourceItemIds
    );

    const contentsByItem = new Map<string, TocContentRow>();
    (allContents || []).forEach((c) => contentsByItem.set(c.toc_item_id, c));

    const allAssignments = await fetchAllByItemIds<TocAssignmentRow>(
      admin,
      "toc_assignments",
      "toc_item_id, user_id, role_in_item",
      "toc_item_id",
      sourceItemIds
    );

    const assignmentsByItem = new Map<string, TocAssignmentRow[]>();
    (allAssignments || []).forEach((a) => {
      const arr = assignmentsByItem.get(a.toc_item_id) || [];
      arr.push(a);
      assignmentsByItem.set(a.toc_item_id, arr);
    });

    // 9) Đệ quy clone subtree
    async function cloneItemTree(oldItem: TocItemRow, newParentId: string | null): Promise<string> {
      // 9.1 Insert toc_item mới (✅ clone kind)
      const { data: insertedItemRows, error: insItemErr } = await admin
        .from("toc_items")
        .insert({
          book_version_id: newVersionId,
          parent_id: newParentId,
          title: oldItem.title,
          slug: oldItem.slug,
          kind: oldItem.kind ?? "chapter",
          order_index: oldItem.order_index,
        })
        .select("id")
        .limit(1);

      if (insItemErr || !insertedItemRows || insertedItemRows.length === 0) {
        throw new Error(insItemErr?.message || "Không clone được một mục TOC.");
      }

      const newItemId = insertedItemRows[0].id as string;

      // 9.2 Clone content nếu có
      const content = contentsByItem.get(oldItem.id);
      if (content) {
        const { error: insContentErr } = await admin.from("toc_contents").insert({
          toc_item_id: newItemId,
          content_json: content.content_json,
          status: content.status,
          updated_by: content.updated_by,
          // updated_at để default
        });

        if (insContentErr) {
          throw new Error(`Không clone được nội dung cho mục TOC: ${insContentErr.message}`);
        }
      }

      // 9.3 Clone assignments nếu có
      const assigns = assignmentsByItem.get(oldItem.id) || [];
      if (assigns.length > 0) {
        const rowsToInsert = assigns.map((a) => ({
          toc_item_id: newItemId,
          user_id: a.user_id,
          role_in_item: a.role_in_item,
        }));

        const { error: insAssignErr } = await admin.from("toc_assignments").insert(rowsToInsert);
        if (insAssignErr) {
          throw new Error(`Không clone được phân công cho mục TOC: ${insAssignErr.message}`);
        }
      }

      // 9.4 Clone children
      const children = getChildren(oldItem.id);
      for (const child of children) {
        await cloneItemTree(child, newItemId);
      }

      return newItemId;
    }

    // 10) Clone các root items (parent_id = null)
    const rootItems = getChildren(null);
    // ổn định thứ tự root theo order_index trước khi clone
    rootItems.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));

    for (const root of rootItems) {
      await cloneItemTree(root, null);
    }

    return NextResponse.json({
      ok: true,
      message: "Tạo bản nháp mới từ bản publish thành công.",
      new_version: newVersion,
    });
  } catch (e: any) {
    console.error("books/version/clone error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Lỗi không xác định khi clone phiên bản sách." },
      { status: 500 }
    );
  }
}
