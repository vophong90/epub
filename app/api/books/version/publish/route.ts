import { NextRequest, NextResponse } from "next/server";
import { getRouteClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  version_id?: string;
};

export async function POST(req: NextRequest) {
  const supabase = getRouteClient();

  // 1) Lấy user hiện tại
  const {
    data: { user },
    error: uErr,
  } = await supabase.auth.getUser();

  if (uErr || !user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  // 2) Kiểm tra user có phải admin không (dựa vào profiles.system_role)
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
      { error: "Chỉ admin mới được publish phiên bản sách" },
      { status: 403 }
    );
  }

  // 3) Lấy version_id từ body
  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const versionId = (body.version_id || "").toString();
  if (!versionId) {
    return NextResponse.json(
      { error: "version_id là bắt buộc" },
      { status: 400 }
    );
  }

  // 4) Lấy book_versions hiện tại
  const { data: version, error: vErr } = await supabase
    .from("book_versions")
    .select("id,book_id,status,locked_by,locked_at,approved_by,approved_at")
    .eq("id", versionId)
    .maybeSingle();

  if (vErr) {
    return NextResponse.json({ error: vErr.message }, { status: 500 });
  }
  if (!version) {
    return NextResponse.json(
      { error: "Không tìm thấy phiên bản sách" },
      { status: 404 }
    );
  }

  if (version.status === "published") {
    return NextResponse.json(
      { error: "Phiên bản này đã được publish trước đó" },
      { status: 400 }
    );
  }

  // 5) Cập nhật status -> published, locked_by, locked_at
  const nowIso = new Date().toISOString();

  const { data: updated, error: upErr } = await supabase
    .from("book_versions")
    .update({
      status: "published",
      locked_by: user.id,
      locked_at: nowIso,
    })
    .eq("id", versionId)
    .select("id,book_id,status,locked_by,locked_at,approved_by,approved_at")
    .maybeSingle();

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    version: updated,
  });
}
