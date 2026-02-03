// app/api/toc/move-to-section/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TocKind = "section" | "chapter" | "heading";

type Body = {
  book_version_id?: string;
  section_id?: string;
  chapter_ids?: string[];
};

type TocItemRow = {
  id: string;
  book_version_id: string;
  parent_id: string | null;
  kind: TocKind;
  order_index: number;
};

function normalizeUuidish(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === "null" || s.toLowerCase() === "undefined")
    return null;
  return s;
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
        { error: "book_version_id không hợp lệ" },
        { status: 400 }
      ),
    };
  }

  const { data: version, error: vErr } = await supabase
    .from("book_versions")
    .select("id,book_id")
    .eq("id", safeVersionId)
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

  return { ok: true as const };
}

export async function POST(req: NextRequest) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }

  let book_version_id = normalizeUuidish(body.book_version_id);
  const section_id = normalizeUuidish(body.section_id);

  const chapter_ids = Array.isArray(body.chapter_ids)
    ? (body.chapter_ids
        .map((x) => normalizeUuidish(x))
        .filter(Boolean) as string[])
    : [];

  // 0) Validate tối thiểu
  if (!section_id) {
    return NextResponse.json(
      { error: "section_id là bắt buộc" },
      { status: 400 }
    );
  }
  if (!chapter_ids.length) {
    return NextResponse.json(
      { error: "chapter_ids phải có ít nhất 1 chương" },
      { status: 400 }
    );
  }

  // 1) Lấy section (đồng thời suy ra book_version_id nếu thiếu)
  const { data: section, error: sErr } = await supabase
    .from("toc_items")
    .select("id,book_version_id,parent_id,kind,order_index")
    .eq("id", section_id)
    .maybeSingle();

  const sec = section as TocItemRow | null;

  if (sErr || !sec) {
    return NextResponse.json(
      { error: "Không tìm thấy PHẦN (section)" },
      { status: 404 }
    );
  }

  if (!book_version_id) book_version_id = normalizeUuidish(sec.book_version_id);

  if (!book_version_id) {
    return NextResponse.json(
      { error: "Không suy ra được book_version_id" },
      { status: 400 }
    );
  }

  // 2) Gate quyền editor theo version
  const gate = await requireEditorByVersionId(
    supabase,
    user!.id,
    book_version_id
  );
  if (!gate.ok) return (gate as any).res;

  // 3) Validate section đúng version, đúng kind, đúng root
  if (sec.book_version_id !== book_version_id) {
    return NextResponse.json(
      { error: "Section không thuộc phiên bản sách này" },
      { status: 400 }
    );
  }
  if (sec.kind !== "section") {
    return NextResponse.json(
      { error: "Mục được chọn không phải là PHẦN (section)" },
      { status: 400 }
    );
  }
  if (sec.parent_id !== null) {
    return NextResponse.json(
      { error: "Section phải là mục root (parent_id = null)" },
      { status: 400 }
    );
  }

  // 4) Lấy các chương cần move trong đúng version
  const { data: chaptersRaw, error: cErr } = await supabase
    .from("toc_items")
    .select("id,book_version_id,parent_id,kind,order_index")
    .eq("book_version_id", book_version_id)
    .in("id", chapter_ids);

  if (cErr) {
    return NextResponse.json(
      { error: cErr.message || "Lỗi khi lấy danh sách chương" },
      { status: 400 }
    );
  }

  const chaptersAll = (chaptersRaw || []) as TocItemRow[];

  // Chỉ nhận chapter root (parent_id null)
  const chaptersToMove = chaptersAll.filter(
    (ch) => ch.kind === "chapter" && ch.parent_id === null
  );

  // Nếu client gửi IDs mà không match được rows
  const foundIds = new Set(chaptersAll.map((c) => c.id));
  const missingIds = chapter_ids.filter((id) => !foundIds.has(id));

  if (missingIds.length) {
    return NextResponse.json(
      {
        error: "Một số chapter_ids không hợp lệ hoặc không thuộc phiên bản này",
        missing_ids: missingIds,
      },
      { status: 400 }
    );
  }

  if (!chaptersToMove.length) {
    return NextResponse.json(
      { error: "Không có chương root hợp lệ để đưa vào PHẦN này" },
      { status: 400 }
    );
  }

  // Sắp theo thứ tự client tick
  const orderIndexMap = new Map<string, number>();
  chapter_ids.forEach((id, idx) => orderIndexMap.set(id, idx));
  chaptersToMove.sort(
    (a, b) =>
      (orderIndexMap.get(a.id) ?? 0) - (orderIndexMap.get(b.id) ?? 0)
  );

  // 5) Lấy order_index lớn nhất trong section (children)
  const { data: lastChild, error: lcErr } = await supabase
    .from("toc_items")
    .select("order_index")
    .eq("book_version_id", book_version_id)
    .eq("parent_id", section_id)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lcErr) {
    return NextResponse.json(
      { error: lcErr.message || "Lỗi khi xác định thứ tự trong PHẦN" },
      { status: 400 }
    );
  }

  let nextOrder =
    ((lastChild as { order_index: number } | null)?.order_index ?? 0) + 1;

  // 6) Move từng chương
  for (const ch of chaptersToMove) {
    const { error: upErr } = await supabase
      .from("toc_items")
      .update({
        parent_id: section_id,
        order_index: nextOrder++,
      })
      .eq("id", ch.id)
      .eq("book_version_id", book_version_id);

    if (upErr) {
      return NextResponse.json(
        { error: upErr.message || "Lỗi khi chuyển chương vào PHẦN" },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({
    ok: true,
    book_version_id,
    section_id,
    moved_count: chaptersToMove.length,
  });
}
