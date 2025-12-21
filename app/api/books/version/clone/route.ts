// app/api/books/version/clone/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase-admin";

/**
 * POST /api/books/version/clone
 *
 * Body:
 * - book_id?: string
 * - source_version_id?: string
 *
 * Logic:
 * - Nếu có source_version_id: dùng version đó làm nguồn (yêu cầu status = 'published')
 * - Nếu không: tìm bản published mới nhất của book_id
 * - Tạo version mới: status = 'draft', version_no = max(version_no) + 1
 * - Clone toàn bộ toc_items, toc_contents, toc_assignments từ source sang version mới
 */

// ====== Pagination helpers (fix Supabase 1000 row cap) ======

async function fetchAllTocItemsByVersion(
  supabase: any,
  sourceVersionId: string
) {
  const PAGE = 1000;
  let from = 0;
  const all: any[] = [];

  while (true) {
    const { data, error } = await supabase
      .from("toc_items")
      .select("id, book_version_id, parent_id, title, slug, order_index, created_at")
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
      const q = supabase
        .from(table)
        .select(selectCols)
        .in(idCol, slice)
        .order(idCol, { ascending: true })
        .range(from, from + PAGE - 1);

      const { data, error } = await q;

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
  const supabase = getAdminClient();

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
      {
        ok: false,
        error: "Cần truyền book_id hoặc source_version_id.",
      },
      { status: 400 }
    );
  }

  try {
    // 1) Xác định source version
    type VersionRow = {
      id: string;
      book_id: string;
      version_no: number;
      status: string;
      created_by: string | null;
      created_at: string | null;
    };

    let sourceVersion: VersionRow | null = null;

    if (source_version_id_input) {
      const { data, error } = await supabase
        .from("book_versions")
        .select("id, book_id, version_no, status, created_by, created_at")
        .eq("id", source_version_id_input)
        .maybeSingle();

      if (error || !data) {
        return NextResponse.json(
          {
            ok: false,
            error: "Không tìm thấy version nguồn.",
          },
          { status: 404 }
        );
      }

      if (data.status !== "published") {
        return NextResponse.json(
          {
            ok: false,
            error: "Chỉ được clone từ version đã publish.",
          },
          { status: 400 }
        );
      }

      sourceVersion = data as VersionRow;
    } else {
      // dùng book_id_input, tìm bản published mới nhất
      const { data, error } = await supabase
        .from("book_versions")
        .select("id, book_id, version_no, status, created_by, created_at")
        .eq("book_id", book_id_input!)
        .eq("status", "published")
        .order("version_no", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Không tìm thấy phiên bản published nào của sách này để clone.",
          },
          { status: 404 }
        );
      }

      sourceVersion = data as VersionRow;
    }

    if (!sourceVersion) {
      return NextResponse.json(
        { ok: false, error: "Không xác định được phiên bản nguồn." },
        { status: 500 }
      );
    }

    const bookId = sourceVersion.book_id;

    // 2) Tìm version_no lớn nhất hiện có để gán version_no mới = max + 1
    const { data: maxVersionRow, error: maxErr } = await supabase
      .from("book_versions")
      .select("version_no")
      .eq("book_id", bookId)
      .order("version_no", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (maxErr) {
      return NextResponse.json(
        {
          ok: false,
          error: `Lỗi khi kiểm tra version hiện có: ${maxErr.message}`,
        },
        { status: 500 }
      );
    }

    const nextVersionNo =
      (maxVersionRow?.version_no ?? sourceVersion.version_no) + 1;

    // 3) Tạo version mới (draft)
    const { data: insertedVersion, error: insVersionErr } = await supabase
      .from("book_versions")
      .insert({
        book_id: bookId,
        version_no: nextVersionNo,
        status: "draft",
        // tái sử dụng created_by cũ nếu có; hoặc để default/null
        created_by: sourceVersion.created_by ?? null,
      })
      .select("id, book_id, version_no, status, created_by, created_at")
      .maybeSingle();

    if (insVersionErr || !insertedVersion) {
      return NextResponse.json(
        {
          ok: false,
          error:
            insVersionErr?.message ||
            "Không tạo được phiên bản nháp mới từ version publish.",
        },
        { status: 500 }
      );
    }

    const newVersion = insertedVersion as VersionRow;
    const newVersionId = newVersion.id;

    // 4) Lấy toàn bộ TOC items của sourceVersion (FIX: pagination)
    type TocItemRow = {
      id: string;
      book_version_id: string;
      parent_id: string | null;
      title: string;
      slug: string;
      order_index: number;
      created_at: string | null;
    };

    const allItems = (await fetchAllTocItemsByVersion(
      supabase,
      sourceVersion.id
    )) as TocItemRow[];

    // Nếu không có nội dung TOC thì không sao, chỉ trả về version mới
    if (allItems.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "Tạo phiên bản nháp mới thành công (không có TOC để clone).",
        new_version: newVersion,
      });
    }

    // 5) Map id -> item, và group theo parent để clone theo tree
    const byId = new Map<string, TocItemRow>(allItems.map((i) => [i.id, i]));
    void byId; // giữ đúng chức năng/biến cũ (tránh lint), dù không dùng trực tiếp

    const childrenMap = new Map<string | null, TocItemRow[]>();

    for (const it of allItems) {
      const key = it.parent_id;
      if (!childrenMap.has(key)) childrenMap.set(key, []);
      childrenMap.get(key)!.push(it);
    }

    // helper: lấy children của một item
    const getChildren = (parentId: string | null) =>
      childrenMap.get(parentId) || [];

    // 6) Clone tree đệ quy: toc_items, toc_contents, toc_assignments
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

    // cache contents & assignments theo toc_item_id để đỡ query lặp lại
    // FIX: chunk+pagination instead of single .in(...)
    const allContents = await fetchAllByItemIds<TocContentRow>(
      supabase,
      "toc_contents",
      "toc_item_id, content_json, status, updated_by, updated_at",
      "toc_item_id",
      sourceItemIds
    );

    const contentsByItem = new Map<string, TocContentRow>();
    (allContents || []).forEach((c) => {
      contentsByItem.set(c.toc_item_id, c as TocContentRow);
    });

    const allAssignments = await fetchAllByItemIds<TocAssignmentRow>(
      supabase,
      "toc_assignments",
      "toc_item_id, user_id, role_in_item",
      "toc_item_id",
      sourceItemIds
    );

    const assignmentsByItem = new Map<string, TocAssignmentRow[]>();
    (allAssignments || []).forEach((a) => {
      const arr =
        assignmentsByItem.get((a as any).toc_item_id) || ([] as TocAssignmentRow[]);
      arr.push(a as TocAssignmentRow);
      assignmentsByItem.set((a as any).toc_item_id, arr);
    });

    // Hàm đệ quy clone một node và toàn bộ subtree của nó
    async function cloneItemTree(
      oldItem: TocItemRow,
      newParentId: string | null
    ): Promise<string> {
      // 6.1 Insert toc_item mới
      const { data: insertedItemRows, error: insItemErr } = await supabase
        .from("toc_items")
        .insert({
          book_version_id: newVersionId,
          parent_id: newParentId,
          title: oldItem.title,
          slug: oldItem.slug,
          order_index: oldItem.order_index,
        })
        .select("id")
        .limit(1);

      if (insItemErr || !insertedItemRows || insertedItemRows.length === 0) {
        throw new Error(insItemErr?.message || "Không clone được một mục TOC.");
      }

      const newItemId = insertedItemRows[0].id as string;

      // 6.2 Clone nội dung nếu có
      const content = contentsByItem.get(oldItem.id);
      if (content) {
        const { error: insContentErr } = await supabase
          .from("toc_contents")
          .insert({
            toc_item_id: newItemId,
            content_json: content.content_json,
            status: content.status,
            updated_by: content.updated_by,
            // updated_at để default/trigger, không nhất thiết dùng lại
          });

        if (insContentErr) {
          throw new Error(
            `Không clone được nội dung cho mục TOC: ${insContentErr.message}`
          );
        }
      }

      // 6.3 Clone assignments nếu có
      const assigns = assignmentsByItem.get(oldItem.id) || [];
      if (assigns.length > 0) {
        const rowsToInsert = assigns.map((a) => ({
          toc_item_id: newItemId,
          user_id: a.user_id,
          role_in_item: a.role_in_item,
        }));

        const { error: insAssignErr } = await supabase
          .from("toc_assignments")
          .insert(rowsToInsert);

        if (insAssignErr) {
          throw new Error(
            `Không clone được phân công cho mục TOC: ${insAssignErr.message}`
          );
        }
      }

      // 6.4 Clone các mục con
      const children = getChildren(oldItem.id);
      for (const child of children) {
        await cloneItemTree(child, newItemId);
      }

      return newItemId;
    }

    // 7) Clone toàn bộ các root items (parent_id = null)
    const rootItems = getChildren(null);
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
      {
        ok: false,
        error: e?.message || "Lỗi không xác định khi clone phiên bản sách.",
      },
      { status: 500 }
    );
  }
}
