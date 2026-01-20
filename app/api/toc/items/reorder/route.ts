// app/api/toc/items/reorder/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TocKind = "section" | "chapter" | "heading";

type Body = {
  book_version_id?: string;
  parent_id?: string | null;
  ordered_ids?: string[];
};

function normalizeUuidish(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === "null") return null;
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

  return { ok: true };
}

export async function POST(req: NextRequest) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const book_version_id = normalizeUuidish(body.book_version_id);
  const parent_id =
    body.parent_id === undefined ? undefined : normalizeUuidish(body.parent_id);

  const ordered_ids = Array.isArray(body.ordered_ids)
    ? body.ordered_ids.map((x) => normalizeUuidish(x)).filter(Boolean) as string[]
    : [];

  if (!book_version_id) {
    return NextResponse.json(
      { error: "book_version_id là bắt buộc" },
      { status: 400 }
    );
  }
  if (!ordered_ids.length) {
    return NextResponse.json(
      { error: "ordered_ids[] là bắt buộc" },
      { status: 400 }
    );
  }

  const gate = await requireEditorByVersionId(
    supabase,
    user!.id,
    book_version_id
  );
  if (!gate.ok) return (gate as any).res;

  // --------- Validate container rules theo kind ---------

  // 1) Load all items in ordered_ids to validate same version + current parent + kind consistency
  const { data: rows, error: rErr } = await supabase
    .from("toc_items")
    .select("id,book_version_id,parent_id,kind")
    .in("id", ordered_ids);

  const items = (rows ?? []) as Array<{
    id: string;
    book_version_id: string;
    parent_id: string | null;
    kind: TocKind;
  }>;

  if (rErr) {
    return NextResponse.json({ error: rErr.message }, { status: 400 });
  }
  if (items.length !== ordered_ids.length) {
    return NextResponse.json(
      { error: "ordered_ids có phần tử không tồn tại" },
      { status: 400 }
    );
  }

  // 2) All must belong to same version_id
  for (const it of items) {
    if (it.book_version_id !== book_version_id) {
      return NextResponse.json(
        { error: "ordered_ids phải thuộc cùng book_version_id" },
        { status: 400 }
      );
    }
  }

  // 3) parent_id must match container (root vs section vs chapter)
  const targetParentId = parent_id === undefined ? null : parent_id; // undefined => treat as null
  for (const it of items) {
    const itParent = it.parent_id ?? null;
    if (itParent !== (targetParentId ?? null)) {
      return NextResponse.json(
        { error: "ordered_ids không cùng parent_id (không cùng container)" },
        { status: 400 }
      );
    }
  }

  // 4) kind consistency inside container
  const distinctKinds = Array.from(new Set(items.map((x) => x.kind)));
  if (distinctKinds.length !== 1) {
    return NextResponse.json(
      { error: "Không được reorder lẫn nhiều loại (section/chapter/heading) trong cùng container" },
      { status: 400 }
    );
  }
  const childKind = distinctKinds[0];

  // 5) Extra rule: validate parent.kind -> child.kind mapping
  if (targetParentId !== null) {
    const { data: parentRow, error: pErr } = await supabase
      .from("toc_items")
      .select("id,kind,book_version_id")
      .eq("id", targetParentId)
      .maybeSingle();

    if (pErr || !parentRow?.id) {
      return NextResponse.json({ error: "parent_id không tồn tại" }, { status: 400 });
    }
    if (parentRow.book_version_id !== book_version_id) {
      return NextResponse.json(
        { error: "parent_id không thuộc cùng book_version_id" },
        { status: 400 }
      );
    }

    const pk = parentRow.kind as TocKind;

    // Flow mới:
    // - Section chứa chapter
    // - Chapter chứa heading
    if (pk === "section" && childKind !== "chapter") {
      return NextResponse.json(
        { error: "Trong Section chỉ được reorder các Chapter" },
        { status: 400 }
      );
    }
    if (pk === "chapter" && childKind !== "heading") {
      return NextResponse.json(
        { error: "Trong Chapter chỉ được reorder các Heading (TOC2/3...)" },
        { status: 400 }
      );
    }
    if (pk === "heading") {
      return NextResponse.json(
        { error: "Không hỗ trợ reorder con của heading" },
        { status: 400 }
      );
    }
  } else {
    // Root: cho phép reorder section riêng, chapter riêng, heading riêng
    // (đã đảm bảo cùng kind ở bước 4)
  }

  // --------- Call RPC như cũ ---------

  const { error: rpcErr } = await supabase.rpc("toc_reorder", {
    p_version_id: book_version_id,
    p_parent_id: targetParentId, // null => root
    p_ordered_ids: ordered_ids,
  });

  if (rpcErr) {
    console.error("toc_reorder rpc error:", rpcErr);
    return NextResponse.json(
      { error: rpcErr.message || "Lỗi khi reorder TOC (RPC)" },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
