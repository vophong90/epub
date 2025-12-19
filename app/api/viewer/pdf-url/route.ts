// app/api/viewer/pdf-url/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { getAdminClient } from "@/lib/supabase-admin";

const BUCKET = "published_pdfs";
const EXPIRES_SEC = 60 * 10; // 10 phút

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const book_id = url.searchParams.get("book_id");
    if (!book_id) {
      return NextResponse.json({ error: "book_id là bắt buộc" }, { status: 400 });
    }

    // 1) Check login bằng cookie session
    const supa = createRouteHandlerClient({ cookies });
    const { data: { user }, error: authErr } = await supa.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
    }

    // 2) Lấy publication active (dùng admin để khỏi dính RLS/storage)
    const admin = getAdminClient();

    const { data: pub, error: pubErr } = await admin
      .from("book_publications")
      .select("pdf_path, published_at, version_id")
      .eq("book_id", book_id)
      .eq("is_active", true)
      .maybeSingle();

    if (pubErr) {
      return NextResponse.json({ error: "Lỗi đọc publication", detail: pubErr.message }, { status: 500 });
    }
    if (!pub?.pdf_path) {
      return NextResponse.json({ error: "Sách chưa được publish PDF" }, { status: 404 });
    }

    // 3) Signed URL
    const { data: signed, error: signErr } = await admin
      .storage
      .from(BUCKET)
      .createSignedUrl(pub.pdf_path, EXPIRES_SEC);

    if (signErr || !signed?.signedUrl) {
      return NextResponse.json({ error: "Không tạo được signed url", detail: signErr?.message }, { status: 500 });
    }

    return NextResponse.json({
      url: signed.signedUrl,
      published_at: pub.published_at,
      version_id: pub.version_id,
      expires_in: EXPIRES_SEC,
    });
  } catch (e: any) {
    return NextResponse.json({ error: "Server error", detail: e?.message || String(e) }, { status: 500 });
  }
}
