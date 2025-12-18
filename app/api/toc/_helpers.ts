import { NextResponse } from "next/server";
import { getRouteClient } from "@/lib/supabaseServer";

export type BookRole = "viewer" | "author" | "editor";

export async function requireUser() {
  const supabase = getRouteClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    return { supabase, user: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { supabase, user: data.user, error: null };
}

export async function getBookContextByVersionId(versionId: string) {
  const { supabase, user, error } = await requireUser();
  if (!user) return { supabase, user, error, book_id: null as string | null, role: null as BookRole | null };

  const { data: version, error: vErr } = await supabase
    .from("book_versions")
    .select("id,book_id")
    .eq("id", versionId)
    .maybeSingle();

  if (vErr || !version?.book_id) {
    return {
      supabase,
      user,
      error: NextResponse.json({ error: "Không tìm thấy phiên bản sách" }, { status: 404 }),
      book_id: null,
      role: null,
    };
  }

  const { data: perm, error: pErr } = await supabase
    .from("book_permissions")
    .select("role")
    .eq("book_id", version.book_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (pErr || !perm?.role) {
    return {
      supabase,
      user,
      error: NextResponse.json({ error: "Bạn không có quyền truy cập sách này" }, { status: 403 }),
      book_id: version.book_id,
      role: null,
    };
  }

  return { supabase, user, error: null, book_id: version.book_id as string, role: perm.role as BookRole };
}

export function canEditToc(role: BookRole | null) {
  return role === "editor";
}

export function canEditContent(role: BookRole | null) {
  return role === "editor" || role === "author";
}
