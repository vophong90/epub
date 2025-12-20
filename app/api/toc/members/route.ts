// app/api/toc/members/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase-admin";

/**
 * GET /api/toc/members?version_id=...
 *
 * Trả về danh sách thành viên cấp sách (book_permissions) + profile (name, email).
 * Response:
 * {
 *   ok: boolean;
 *   book_id?: string;
 *   members?: { user_id: string; role: string; profile: { id: string; name: string | null; email: string | null } | null }[];
 *   error?: string;
 * }
 */
export async function GET(req: NextRequest) {
  const supabase = getAdminClient();

  const { searchParams } = new URL(req.url);
  const versionId = searchParams.get("version_id");

  if (!versionId) {
    return NextResponse.json(
      { ok: false, error: "Thiếu version_id." },
      { status: 400 }
    );
  }

  try {
    // 1) Lấy book_id từ book_versions
    const { data: versionRow, error: vErr } = await supabase
      .from("book_versions")
      .select("id, book_id")
      .eq("id", versionId)
      .maybeSingle();

    if (vErr || !versionRow) {
      return NextResponse.json(
        {
          ok: false,
          error: "Không tìm thấy phiên bản sách tương ứng.",
        },
        { status: 404 }
      );
    }

    const bookId: string = versionRow.book_id;

    // 2) Lấy quyền ở cấp sách từ book_permissions (không join profiles ở đây)
    type PermRow = {
      user_id: string;
      role: string;
    };

    const { data: perms, error: pErr } = await supabase
      .from("book_permissions")
      .select("user_id, role")
      .eq("book_id", bookId);

    if (pErr) {
      console.error("book_permissions query error:", pErr);
      return NextResponse.json(
        {
          ok: false,
          error: `Lỗi khi đọc phân quyền sách: ${pErr.message}`,
        },
        { status: 500 }
      );
    }

    const permRows: PermRow[] = (perms || []) as PermRow[];

    if (permRows.length === 0) {
      return NextResponse.json({
        ok: true,
        book_id: bookId,
        members: [],
      });
    }

    // 3) Lấy profile (name, email) của các user đó từ bảng profiles
    const userIds = Array.from(new Set(permRows.map((p) => p.user_id)));

    type ProfileRow = {
      id: string;
      name: string | null;
      email: string | null;
    };

    const { data: profileRows, error: profErr } = await supabase
      .from("profiles")
      .select("id, name, email")
      .in("id", userIds);

    if (profErr) {
      console.error("profiles query error:", profErr);
      // vẫn trả về được danh sách user nhưng profile = null
    }

    const profilesById = new Map<string, ProfileRow>();
    (profileRows || []).forEach((p) => {
      profilesById.set(p.id, p as ProfileRow);
    });

    // 4) Gộp lại thành danh sách members
    const members = permRows.map((p) => ({
      user_id: p.user_id,
      role: p.role,
      profile: profilesById.get(p.user_id) || null,
    }));

    return NextResponse.json({
      ok: true,
      book_id: bookId,
      members,
    });
  } catch (e: any) {
    console.error("GET /api/toc/members error:", e);
    return NextResponse.json(
      {
        ok: false,
        error:
          e?.message ||
          "Lỗi không xác định khi tải danh sách thành viên của sách.",
      },
      { status: 500 }
    );
  }
}
