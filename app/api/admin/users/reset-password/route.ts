// app/api/admin/users/reset-password/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRouteClient } from "@/lib/supabaseServer";
import { getAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  profile_id?: string;
};

const DEFAULT_PASSWORD = "12345678@";

export async function POST(req: NextRequest) {
  const supabase = getRouteClient(); // client dùng cookie (session user)
  const admin = getAdminClient();    // service-role client

  // 1) Check đang đăng nhập
  const {
    data: { user },
    error: uErr,
  } = await supabase.auth.getUser();

  if (uErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2) Chỉ admin mới được reset mật khẩu người khác
  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("id,system_role")
    .eq("id", user.id)
    .maybeSingle();

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }

  if (!profile || profile.system_role !== "admin") {
    return NextResponse.json(
      { error: "Chỉ admin mới được reset mật khẩu" },
      { status: 403 }
    );
  }

  // 3) Lấy profile_id của user cần reset
  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const targetId = (body.profile_id || "").toString();
  if (!targetId) {
    return NextResponse.json(
      { error: "profile_id là bắt buộc" },
      { status: 400 }
    );
  }

  // 4) Kiểm tra user có tồn tại không (profiles)
  const { data: targetProfile, error: tpErr } = await admin
    .from("profiles")
    .select("id,email")
    .eq("id", targetId)
    .maybeSingle();

  if (tpErr) {
    return NextResponse.json({ error: tpErr.message }, { status: 500 });
  }
  if (!targetProfile) {
    return NextResponse.json(
      { error: "Không tìm thấy user trong bảng profiles" },
      { status: 404 }
    );
  }

  // 5) Đặt lại mật khẩu mặc định qua Supabase Admin API
  const { error: upErr } = await admin.auth.admin.updateUserById(targetId, {
    password: DEFAULT_PASSWORD,
    email_confirm: true,
  });

  if (upErr) {
    return NextResponse.json(
      {
        error: "Đặt lại mật khẩu mặc định thất bại",
        detail: upErr.message,
      },
      { status: 500 }
    );
  }

  // tuỳ bạn: có thể không trả password về JSON, hoặc chỉ log trên UI admin
  return NextResponse.json({
    ok: true,
    new_password: DEFAULT_PASSWORD,
  });
}
