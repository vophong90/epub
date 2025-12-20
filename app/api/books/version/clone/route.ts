// app/api/books/version/clone/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const book_id = String(body.book_id || "");

  if (!book_id) {
    return NextResponse.json(
      { error: "book_id là bắt buộc" },
      { status: 400 }
    );
  }

  // 1) Kiểm tra user có quyền quản lý sách này không
  //  - Nếu là system admin (profiles.system_role = 'admin') => OK
  //  - Hoặc có book_permissions.role = 'editor' => OK
  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("id, system_role")
    .eq("id", user!.id)
    .maybeSingle();

  if (pErr) {
    return NextResponse.json(
      { error: "Không lấy được thông tin profile" },
      { status: 400 }
    );
  }

  const isSystemAdmin = profile?.system_role === "admin";

  const { data: perm, error: permErr } = await supabase
    .from("book_permissions")
    .select("role")
    .eq("book_id", book_id)
    .eq("user_id", user!.id)
    .maybeSingle();

  const isBookEditor = perm?.role === "editor";

  if (!isSystemAdmin && !isBookEditor) {
    return NextResponse.json(
      { error: "Chỉ admin hoặc editor của sách mới được tạo phiên bản nháp mới" },
      { status: 403 }
    );
  }

  // 2) Không cho tạo nếu đã có bản NHÁP
  const { data: draftVersion, error: draftErr } = await supabase
    .from("book_versions")
    .select("id, version_no, status")
    .eq("book_id", book_id)
    .eq("status", "draft")
    .maybeSingle();

  if (draftErr) {
    return NextResponse.json(
      { error: draftErr.message },
      { status: 400 }
    );
  }

  if (draftVersion) {
    return NextResponse.json(
      { error: "Đã tồn tại một phiên bản nháp cho sách này. Vui lòng sử dụng phiên bản nháp hiện tại." },
      { status: 400 }
    );
  }

  // 3) Lấy phiên bản PUBLISHED mới nhất làm nguồn clone
  const { data: baseVersion, error: baseErr } = await supabase
    .from("book_versions")
    .select("id, book_id, version_no")
    .eq("book_id", book_id)
    .eq("status", "published")
    .order("version_no", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (baseErr) {
    return NextResponse.json(
      { error: baseErr.message },
      { status: 400 }
    );
  }

  if (!baseVersion) {
    return NextResponse.json(
      { error: "Chưa có phiên bản published nào để clone" },
      { status: 400 }
    );
  }

  // 4) Xác định version_no tiếp theo
  const { data: maxVersion, error: maxErr } = await supabase
    .from("book_versions")
    .select("version_no")
    .eq("book_id", book_id)
    .order("version_no", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxErr) {
    return NextResponse.json(
      { error: maxErr.message },
      { status: 400 }
    );
  }

  const nextVersionNo = (maxVersion?.version_no ?? 0) + 1;

  // 5) Tạo bản nháp mới
  const { data: newVersion, error: newVersionErr } = await supabase
    .from("book_versions")
    .insert({
      book_id,
      version_no: nextVersionNo,
      status: "draft",
      created_by: user!.id,
    })
    .select("id, book_id, version_no, status, created_at")
    .maybeSingle();

  if (newVersionErr || !newVersion) {
    return NextResponse.json(
      { error: newVersionErr?.message || "Không tạo được phiên bản nháp mới" },
      { status: 400 }
    );
  }

  const newVersionId = newVersion.id as string;
  const baseVersionId = baseVersion.id as string;

  // 6) Clone TOC: toc_items
  const { data: baseItems, error: itemsErr } = await supabase
    .from("toc_items")
    .select("id, parent_id, title, slug, order_index, created_at")
    .eq("book_version_id", baseVersionId)
    .order("parent_id", { ascending: true })
    .order("order_index", { ascending: true });

  if (itemsErr) {
    return NextResponse.json(
      { error: itemsErr.message },
      { status: 400 }
    );
  }

  const idMap = new Map<string, string>(); // old_id -> new_id

  // Để chắc chắn parent được insert trước, ta lặp nhiều vòng cho đến khi không còn item nào pending
  const pending = [...(baseItems || [])];

  while (pending.length > 0) {
    let progressed = false;

    for (let i = pending.length - 1; i >= 0; i--) {
      const item = pending[i];

      const parentId = item.parent_id as string | null;
      if (parentId && !idMap.get(parentId)) {
        // parent chưa được tạo
        continue;
      }

      const newParentId = parentId ? idMap.get(parentId)! : null;

      const { data: inserted, error: insErr } = await supabase
        .from("toc_items")
        .insert({
          book_version_id: newVersionId,
          parent_id: newParentId,
          title: item.title,
          slug: item.slug,
          order_index: item.order_index,
        })
        .select("id")
        .maybeSingle();

      if (insErr || !inserted) {
        console.error("clone toc_items error:", insErr);
        return NextResponse.json(
          { error: insErr?.message || "Lỗi khi clone mục lục (toc_items)" },
          { status: 400 }
        );
      }

      idMap.set(item.id as string, inserted.id as string);
      pending.splice(i, 1);
      progressed = true;
    }

    if (!progressed) {
      // Có vòng lặp bất thường, tránh loop vô hạn
      console.error("Không thể resolve toàn bộ cây TOC khi clone");
      break;
    }
  }

  // 7) Clone nội dung: toc_contents
  if (baseItems && baseItems.length > 0) {
    const baseIds = baseItems.map((it) => it.id as string);

    const { data: baseContents, error: contentsErr } = await supabase
      .from("toc_contents")
      .select("toc_item_id, content_json, status")
      .in("toc_item_id", baseIds);

    if (contentsErr) {
      console.error("clone toc_contents error:", contentsErr);
      // Không fail toàn bộ, chỉ cảnh báo
    } else if (baseContents && baseContents.length > 0) {
      for (const c of baseContents) {
        const oldId = c.toc_item_id as string;
        const newTocId = idMap.get(oldId);
        if (!newTocId) continue;

        const { error: insContentErr } = await supabase
          .from("toc_contents")
          .insert({
            toc_item_id: newTocId,
            content_json: c.content_json,
            status: "draft", // luôn reset về draft
            updated_by: user!.id,
          });

        if (insContentErr) {
          console.error("insert toc_contents clone error:", insContentErr);
          // tiếp tục các item khác, không stop toàn bộ
        }
      }
    }
  }

  // 8) Clone phân công: toc_assignments
  if (baseItems && baseItems.length > 0) {
    const baseIds = baseItems.map((it) => it.id as string);

    const { data: baseAssigns, error: assignsErr } = await supabase
      .from("toc_assignments")
      .select("toc_item_id, user_id, role_in_item")
      .in("toc_item_id", baseIds);

    if (assignsErr) {
      console.error("clone toc_assignments error:", assignsErr);
      // không fail toàn bộ
    } else if (baseAssigns && baseAssigns.length > 0) {
      for (const a of baseAssigns) {
        const oldId = a.toc_item_id as string;
        const newTocId = idMap.get(oldId);
        if (!newTocId) continue;

        const { error: insAssignErr } = await supabase
          .from("toc_assignments")
          .insert({
            toc_item_id: newTocId,
            user_id: a.user_id,
            role_in_item: a.role_in_item,
          });

        if (insAssignErr) {
          console.error("insert toc_assignments clone error:", insAssignErr);
          // tiếp tục các assign khác
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    new_version: newVersion,
  });
}
