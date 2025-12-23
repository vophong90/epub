// app/api/toc/import-docx/apply/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser, BookRole } from "../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PreviewSection = {
  title: string;
  html: string;
};

type Body = {
  toc_item_id?: string;
  rootHtml?: string;
  subsections?: PreviewSection[];
  replaceExisting?: boolean;
};

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

function canManageItem(bookRole: BookRole, assignment: any | null) {
  if (bookRole === "editor") return true;
  if (bookRole === "author" && assignment && assignment.role_in_item === "author") {
    return true;
  }
  return false;
}

async function getItemContext(supabase: any, userId: string, tocItemId: string) {
  // Lấy toc_item gốc (chương)
  const { data: item, error: iErr } = await supabase
    .from("toc_items")
    .select("id,book_version_id")
    .eq("id", tocItemId)
    .maybeSingle();

  if (iErr || !item) {
    return {
      ok: false as const,
      res: NextResponse.json(
        { error: "Không tìm thấy mục TOC tương ứng" },
        { status: 404 }
      ),
    };
  }

  // book_version → book
  const { data: version, error: vErr } = await supabase
    .from("book_versions")
    .select("id,book_id")
    .eq("id", item.book_version_id)
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

  // Assignment với mục này (chương)
  const { data: assignment } = await supabase
    .from("toc_assignments")
    .select("id,user_id,role_in_item")
    .eq("toc_item_id", tocItemId)
    .eq("user_id", userId)
    .maybeSingle();

  return {
    ok: true as const,
    item,
    version,
    bookRole,
    assignment,
  };
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

  const tocItemId = String(body.toc_item_id || "");
  if (!tocItemId) {
    return NextResponse.json(
      { error: "toc_item_id là bắt buộc" },
      { status: 400 }
    );
  }

  const subsections = Array.isArray(body.subsections) ? body.subsections : [];
  if (!subsections.length) {
    return NextResponse.json(
      { error: "Danh sách subsections trống" },
      { status: 400 }
    );
  }

  const rootHtml =
    typeof body.rootHtml === "string" && body.rootHtml.trim()
      ? body.rootHtml
      : "<p></p>";

  const replaceExisting = !!body.replaceExisting;

  // 1) Check quyền với chương này
  const ctx = await getItemContext(supabase, user!.id, tocItemId);
  if (!ctx.ok) return ctx.res;

  const { item, bookRole, assignment } = ctx;

  if (!canManageItem(bookRole, assignment)) {
    return NextResponse.json(
      {
        error:
          "Bạn không có quyền áp dụng nội dung Word cho chương này (chỉ Editor hoặc Author được phân công).",
      },
      { status: 403 }
    );
  }

  // 2) Nếu replaceExisting: xoá toàn bộ mục con cũ
  if (replaceExisting) {
    const { error: delErr } = await supabase
      .from("toc_items")
      .delete()
      .eq("book_version_id", item.book_version_id)
      .eq("parent_id", item.id);

    if (delErr) {
      return NextResponse.json(
        { error: `Xoá mục con cũ thất bại: ${delErr.message}` },
        { status: 400 }
      );
    }
  }

  // 3) Lấy sẵn tất cả slug hiện có của book_version này để tránh trùng
  const { data: existingItems, error: exErr } = await supabase
    .from("toc_items")
    .select("slug")
    .eq("book_version_id", item.book_version_id);

  if (exErr) {
    return NextResponse.json(
      { error: "Không lấy được danh sách slug hiện có: " + exErr.message },
      { status: 400 }
    );
  }

  const existingSlugs = new Set<string>(
    (existingItems || [])
      .map((r: any) => r.slug)
      .filter((s: any) => typeof s === "string")
  );

  // 4) Xác định order_index start
  let baseOrder = 1;
  if (!replaceExisting) {
    const { data: maxRow } = await supabase
      .from("toc_items")
      .select("order_index")
      .eq("book_version_id", item.book_version_id)
      .eq("parent_id", item.id)
      .order("order_index", { ascending: false })
      .limit(1)
      .maybeSingle();

    baseOrder = (maxRow?.order_index ?? 0) + 1;
  }

  // 5) Upsert nội dung root (chương)
  {
    const { error: upErr } = await supabase
      .from("toc_contents")
      .upsert(
        {
          toc_item_id: tocItemId,
          content_json: {
            type: "richtext",
            html: rootHtml,
          },
          updated_by: user!.id,
        },
        { onConflict: "toc_item_id" }
      );

    if (upErr) {
      return NextResponse.json(
        { error: `Lưu nội dung chương thất bại: ${upErr.message}` },
        { status: 400 }
      );
    }
  }

  // 6) Tạo mục con mới + nội dung, đảm bảo slug không trùng (retry nếu DB báo 23505)
  const createdIds: string[] = [];

  for (let i = 0; i < subsections.length; i++) {
    const sec = subsections[i];
    const rawTitle = (sec.title || "").toString().trim();
    if (!rawTitle) continue;

    const html = (sec.html || "").toString().trim() || "<p></p>";

    // baseSlug từ title
    let baseSlug = slugify(rawTitle);
    if (!baseSlug) {
      baseSlug = `sub-${Date.now()}-${i}`;
    }

    let newId: string | null = null;
    let attempt = 0;

    // Thử tối đa 10 lần: slug, slug-2, slug-3, ...
    while (attempt < 10 && !newId) {
      let slug = baseSlug;

      if (attempt > 0) {
        const suffixStr = `-${attempt + 1}`; // attempt=0: slug, 1: slug-2, 2: slug-3...
        const maxBaseLen = 80 - suffixStr.length;
        const trimmedBase =
          baseSlug.length > maxBaseLen ? baseSlug.slice(0, maxBaseLen) : baseSlug;
        slug = `${trimmedBase}${suffixStr}`;
      }

      // Nếu trong bộ nhớ đã thấy slug này, tăng attempt luôn để tránh call DB thừa
      if (existingSlugs.has(slug)) {
        attempt++;
        continue;
      }

      const { data: newItem, error: insErr } = await supabase
        .from("toc_items")
        .insert({
          book_version_id: item.book_version_id,
          parent_id: item.id,
          title: rawTitle,
          slug,
          order_index: baseOrder + i,
        })
        .select("id")
        .maybeSingle();

      if (!insErr && newItem?.id) {
        newId = newItem.id as string;
        existingSlugs.add(slug);
        break;
      }

      // Nếu DB báo trùng (23505) thì tăng attempt để thử slug-2, slug-3...
      if (insErr?.code === "23505") {
        attempt++;
        continue;
      }

      // Các lỗi khác: trả về luôn
      const msg = insErr?.message || "";
      return NextResponse.json(
        { error: `Tạo mục con "${rawTitle}" thất bại: ${msg}` },
        { status: 400 }
      );
    }

    if (!newId) {
      return NextResponse.json(
        {
          error: `Tạo mục con "${rawTitle}" thất bại: Không tìm được slug khả dụng sau nhiều lần thử.`,
        },
        { status: 400 }
      );
    }

    createdIds.push(newId);

    // 6.2) Upsert nội dung cho mục con
    const { error: cErr } = await supabase
      .from("toc_contents")
      .upsert(
        {
          toc_item_id: newId,
          content_json: {
            type: "richtext",
            html,
          },
          updated_by: user!.id,
        },
        { onConflict: "toc_item_id" }
      );

    if (cErr) {
      return NextResponse.json(
        {
          error: `Lưu nội dung cho mục con "${rawTitle}" thất bại: ${cErr.message}`,
        },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({
    ok: true,
    toc_item_id: tocItemId,
    created_count: createdIds.length,
    replaced: replaceExisting,
  });
}
