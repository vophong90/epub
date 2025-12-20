// app/api/admin/users/[userId]/books/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRouteClient } from "@/lib/supabaseServer";
import { getAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BookRow = {
  id: string;
  title: string;
};

type PermRow = {
  book_id: string;
  role: string;
};

async function ensureAdmin() {
  const supabase = getRouteClient();
  const {
    data: { user },
    error: uErr,
  } = await supabase.auth.getUser();

  if (uErr || !user) {
    return {
      errorRes: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("id,system_role")
    .eq("id", user.id)
    .maybeSingle();

  if (pErr) {
    return {
      errorRes: NextResponse.json({ error: pErr.message }, { status: 500 }),
    };
  }

  if (!profile || profile.system_role !== "admin") {
    return {
      errorRes: NextResponse.json(
        { error: "Chỉ admin mới dùng API này" },
        { status: 403 }
      ),
    };
  }

  const admin = getAdminClient();
  return { supabase, admin, user };
}

// ⚠️ Ở đây KHÔNG annotate kiểu tham số 2 chi tiết nữa, để any cho Next vui
export async function GET(req: NextRequest, context: any) {
  const check = await ensureAdmin();
  if ("errorRes" in check) return check.errorRes;
  const { admin } = check;

  const userId = context?.params?.userId as string | undefined;

  if (!userId) {
    return NextResponse.json(
      { error: "userId là bắt buộc" },
      { status: 400 }
    );
  }

  // Lấy danh sách sách
  const { data: books, error: bErr } = await admin
    .from("books")
    .select("id,title")
    .order("created_at", { ascending: false });

  if (bErr) {
    console.error("books select error:", bErr);
    return NextResponse.json(
      { error: "Không lấy được danh sách sách" },
      { status: 500 }
    );
  }

  // Lấy quyền sách của user
  const { data: perms, error: pErr } = await admin
    .from("book_permissions")
    .select("book_id,role")
    .eq("user_id", userId);

  if (pErr) {
    console.error("book_permissions select error:", pErr);
    return NextResponse.json(
      { error: "Không lấy được danh sách quyền sách" },
      { status: 500 }
    );
  }

  const roleByBook = new Map<string, string>();
  (perms as PermRow[]).forEach((p) => {
    roleByBook.set(p.book_id, p.role);
  });

  const result = (books as BookRow[]).map((b) => ({
    book_id: b.id,
    title: b.title,
    role:
      (roleByBook.get(b.id) as "viewer" | "author" | "editor" | undefined) ??
      null,
  }));

  return NextResponse.json({ books: result });
}
