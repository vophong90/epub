// app/api/admin/users/reset-password/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRouteClient } from "@/lib/supabaseServer";
import { getAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      errorRes: NextResponse.json(
        { error: pErr.message },
        { status: 500 }
      ),
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

type Body = { user_id?: string };

export async function POST(req: NextRequest) {
  const check = await ensureAdmin();
  if ("errorRes" in check) return check.errorRes;
  const { admin } = check;

  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const user_id = (body.user_id || "").trim();
  if (!user_id) {
    return NextResponse.json(
      { error: "user_id là bắt buộc" },
      { status: 400 }
    );
  }

  const { data: profile, error: pErr } = await admin
    .from("profiles")
    .select("id,email")
    .eq("id", user_id)
    .maybeSingle();

  if (pErr) {
    return NextResponse.json(
      { error: pErr.message },
      { status: 500 }
    );
  }
  if (!profile || !profile.email) {
    return NextResponse.json(
      { error: "Không tìm thấy email user" },
      { status: 400 }
    );
  }

  const { error: rErr } = await admin.auth.admin.resetPasswordForEmail(
    profile.email
  );

  if (rErr) {
    return NextResponse.json(
      { error: "Gửi email reset thất bại: " + rErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
