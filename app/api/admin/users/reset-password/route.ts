// app/api/admin/users/reset-password/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRouteClient } from "@/lib/supabaseServer";
import { getAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  profile_id?: string;
};

const DEFAULT_PASSWORD = "Epub@2026#";

export async function POST(req: NextRequest) {
  const supabase = getRouteClient();
  const admin = getAdminClient();

  // 1) Kiểm tra đang đăng nhập
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

  // 3) Đọc body
  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Body JSON không hợp lệ" },
      { status: 400 }
    );
  }

  const targetId = String(body.profile_id || "").trim();

  if (!targetId) {
    return NextResponse.json(
      { error: "profile_id là bắt buộc" },
      { status: 400 }
    );
  }

  // 4) Kiểm tra profile mục tiêu có tồn tại không
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

  // 5) Reset password bằng Admin API
  const { data, error: upErr } = await admin.auth.admin.updateUserById(
    targetId,
    {
      password: DEFAULT_PASSWORD,
    }
  );

  if (upErr) {
    console.error("RESET PASSWORD ERROR:", upErr);

    return NextResponse.json(
      {
        error: "Đặt lại mật khẩu mặc định thất bại",
        detail: upErr.message,
        code: (upErr as any)?.code ?? null,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    user: {
      id: data.user?.id,
      email: data.user?.email,
    },
    new_password: DEFAULT_PASSWORD,
  });
}
