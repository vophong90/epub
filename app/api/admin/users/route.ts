// app/api/admin/users/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRouteClient } from "@/lib/supabaseServer";
import { getAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

type CreateBody = {
  email?: string;
  full_name?: string;
  system_role?: string;
};

type BookRoleInput = {
  book_id?: string;
  role?: string | null;
};

type UpdateBody = {
  id?: string;
  email?: string;
  full_name?: string;
  system_role?: string;
  book_roles?: BookRoleInput[];
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

// GET /api/admin/users?page=&q=
export async function GET(req: NextRequest) {
  const check = await ensureAdmin();
  if ("errorRes" in check) return check.errorRes;
  const { admin } = check;

  const url = new URL(req.url);
  const pageParam = url.searchParams.get("page") || "1";
  const q = (url.searchParams.get("q") || "").trim();

  let page = parseInt(pageParam, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = admin
    .from("profiles")
    .select("id,email,name,system_role,created_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (q) {
    query = query.or(`email.ilike.%${q}%,name.ilike.%${q}%`);
  }

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    users: data || [],
    page,
    pageSize: PAGE_SIZE,
    total: count ?? 0,
  });
}

// POST /api/admin/users  (tạo user)
export async function POST(req: NextRequest) {
  const check = await ensureAdmin();
  if ("errorRes" in check) return check.errorRes;
  const { admin } = check;

  let body: CreateBody = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const email = (body.email || "").trim();
  const full_name = (body.full_name || "").trim();
  const system_role = (body.system_role || "").trim();

  if (!email || !full_name) {
    return NextResponse.json(
      { error: "email và full_name là bắt buộc" },
      { status: 400 }
    );
  }

  const role =
    system_role && ["admin", "editor", "viewer"].includes(system_role)
      ? system_role
      : "viewer";

  // 1) Tạo user trong auth
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: false,
    user_metadata: { full_name },
  });

  if (cErr || !created?.user) {
    return NextResponse.json(
      { error: cErr?.message || "Tạo user auth thất bại" },
      { status: 500 }
    );
  }

  const userId = created.user.id;

  // 2) Tạo profile
  const { data: profile, error: pErr } = await admin
    .from("profiles")
    .insert({
      id: userId,
      email,
      name: full_name,
      system_role: role,
    })
    .select("id,email,name,system_role,created_at")
    .maybeSingle();

  if (pErr) {
    return NextResponse.json(
      { error: "Tạo profile thất bại: " + pErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, user: profile });
}

// PATCH /api/admin/users  (update tên/email/role + quyền sách)
export async function PATCH(req: NextRequest) {
  const check = await ensureAdmin();
  if ("errorRes" in check) return check.errorRes;
  const { admin } = check;

  let body: UpdateBody = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const id = (body.id || "").trim();
  if (!id) {
    return NextResponse.json({ error: "id là bắt buộc" }, { status: 400 });
  }

  const email = body.email?.trim();
  const full_name = body.full_name?.trim();
  const system_role = body.system_role?.trim();
  const rawBookRoles = Array.isArray(body.book_roles) ? body.book_roles : [];

  const hasAuthProfileChange = !!(email || full_name || system_role);
  const hasBookRolesChange = rawBookRoles.length > 0;

  if (!hasAuthProfileChange && !hasBookRolesChange) {
    return NextResponse.json(
      { error: "Không có gì để cập nhật" },
      { status: 400 }
    );
  }

  // 1) Cập nhật auth.users (email + full_name)
  if (email || full_name) {
    const updatePayload: any = {};
    if (email) updatePayload.email = email;
    if (full_name) updatePayload.user_metadata = { full_name };

    const { error: aErr } = await admin.auth.admin.updateUserById(
      id,
      updatePayload
    );
    if (aErr) {
      return NextResponse.json(
        { error: "update auth.users failed: " + aErr.message },
        { status: 500 }
      );
    }
  }

  // 2) Cập nhật profiles (nếu có field hợp lệ)
  let updatedProfile: any = null;
  const upd: Record<string, unknown> = {};
  if (email) upd.email = email;
  if (full_name) upd.name = full_name;
  if (system_role && ["admin", "editor", "viewer"].includes(system_role)) {
    upd.system_role = system_role;
  }

  if (Object.keys(upd).length > 0) {
    const { data, error: pErr } = await admin
      .from("profiles")
      .update(upd)
      .eq("id", id)
      .select("id,email,name,system_role,created_at")
      .maybeSingle();

    if (pErr) {
      return NextResponse.json(
        { error: "update profiles failed: " + pErr.message },
        { status: 500 }
      );
    }
    updatedProfile = data;
  }

  // 3) Cập nhật quyền sách (book_permissions)
  if (hasBookRolesChange) {
    // Xoá hết quyền cũ của user
    const { error: delErr } = await admin
      .from("book_permissions")
      .delete()
      .eq("user_id", id);

    if (delErr) {
      return NextResponse.json(
        { error: "Không xoá được quyền sách cũ: " + delErr.message },
        { status: 500 }
      );
    }

    // Lọc những dòng hợp lệ (có book_id + role hợp lệ)
    const cleanedRoles = rawBookRoles
      .filter((r) => r.book_id && r.role)
      .filter((r) =>
        ["viewer", "author", "editor"].includes((r.role || "") as string)
      ) as { book_id: string; role: string }[];

    if (cleanedRoles.length > 0) {
      const insertPayload = cleanedRoles.map((r) => ({
        user_id: id,
        book_id: r.book_id,
        role: r.role, // enum public.book_role: 'viewer' | 'author' | 'editor'
      }));

      const { error: insErr } = await admin
        .from("book_permissions")
        .insert(insertPayload);

      if (insErr) {
        return NextResponse.json(
          { error: "Không ghi được quyền sách mới: " + insErr.message },
          { status: 500 }
        );
      }
    }
  }

  return NextResponse.json({
    ok: true,
    user: updatedProfile, // UI hiện tại không dùng, nhưng để sẵn
  });
}
