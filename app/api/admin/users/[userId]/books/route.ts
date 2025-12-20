// app/api/admin/users/[userId]/books/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase-admin";

type BookRow = {
  id: string;
  title: string;
};

type PermRow = {
  book_id: string;
  role: string;
};

export async function GET(
  req: NextRequest,
  context: { params: { userId: string } }
) {
  const userId = context.params.userId;

  if (!userId) {
    return NextResponse.json(
      { error: "userId là bắt buộc" },
      { status: 400 }
    );
  }

  const s = getAdminClient();

  // TODO: tuỳ anh, có thể check quyền system_role=admin ở đây nếu cần

  const { data: books, error: bErr } = await s
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

  const { data: perms, error: pErr } = await s
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
    role: (roleByBook.get(b.id) as "viewer" | "author" | "editor" | undefined) ?? null,
  }));

  return NextResponse.json({ books: result });
}
