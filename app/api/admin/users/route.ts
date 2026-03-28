// app/api/admin/users/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getRouteClient } from "@/lib/supabaseServer";
import { getAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateBody = {
  email?: string;
  full_name?: string;
  system_role?: string;
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
  return { admin };
}

// GET /api/admin/users
export async function GET() {
  const check = await ensureAdmin();
  if ("errorRes" in check) return check.errorRes;

  const { admin } = check;

  const { data, error } = await admin
    .from("profiles")
    .select("id,email,name,system_role,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, users: data });
}

// POST /api/admin/users
export async function POST(req: NextRequest) {
  const check = await ensureAdmin();
  if ("errorRes" in check) return check.errorRes;

  const { admin } = check;

  let body: CreateBody = {};

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Body JSON không hợp lệ" },
      { status: 400 }
    );
  }

  const email = (body.email || "").trim().toLowerCase();
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

  try {
    // 1) Tạo user trong auth.users
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: false,
      user_metadata: { full_name },
    });

    if (cErr || !created?.user) {
      return NextResponse.json(
        { error: cErr?.message || "Tạo auth user thất bại" },
        { status: 500 }
      );
    }

    const userId = created.user.id;

    // 2) profiles đã được trigger tạo tự động
    // chỉ update thông tin
    const { data: profile, error: pErr } = await admin
      .from("profiles")
      .update({
        email,
        name: full_name,
        system_role: role,
      })
      .eq("id", userId)
      .select("id,email,name,system_role,created_at")
      .maybeSingle();

    if (pErr) {
      return NextResponse.json(
        { error: "Cập nhật profile thất bại: " + pErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      user: profile,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Lỗi server không xác định" },
      { status: 500 }
    );
  }
}

// PATCH /api/admin/users
export async function PATCH(req: NextRequest) {
  const check = await ensureAdmin();
  if ("errorRes" in check) return check.errorRes;

  const { admin } = check;

  const body = await req.json();

  const id = body?.id;
  const name = body?.name;
  const role = body?.system_role;

  if (!id) {
    return NextResponse.json({ error: "Thiếu id user" }, { status: 400 });
  }

  const updateData: any = {};

  if (name) updateData.name = name;
  if (role && ["admin", "editor", "viewer"].includes(role))
    updateData.system_role = role;

  const { data, error } = await admin
    .from("profiles")
    .update(updateData)
    .eq("id", id)
    .select("id,email,name,system_role,created_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, user: data });
}
