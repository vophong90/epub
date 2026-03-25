export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRouteClient } from "@/lib/supabaseServer";
import { getAdminClient } from "@/lib/supabase-admin";

const BUCKET = "published_pdfs";
const EXPIRES_SEC = 60;

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: Params) {
  try {
    const { id: bookId } = await context.params;
    if (!bookId) {
      return NextResponse.json({ error: "Thiếu book id" }, { status: 400 });
    }

    const supabase = getRouteClient();
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json(
        { error: "Bạn cần đăng nhập để tải PDF." },
        { status: 401 }
      );
    }

    const admin = getAdminClient();

    const { data: pub, error } = await admin
      .from("book_publications")
      .select("pdf_path, is_active")
      .eq("book_id", bookId)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: "Lỗi đọc publication", detail: error.message },
        { status: 500 }
      );
    }

    if (!pub?.pdf_path) {
      return NextResponse.json(
        { error: "Không tìm thấy PDF đã publish" },
        { status: 404 }
      );
    }

    const { data: signed, error: signErr } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(pub.pdf_path, EXPIRES_SEC, {
        download: true,
      });

    if (signErr || !signed?.signedUrl) {
      return NextResponse.json(
        { error: "Không tạo được link tải", detail: signErr?.message },
        { status: 500 }
      );
    }

    return NextResponse.redirect(signed.signedUrl, { status: 302 });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Server error", detail: e?.message || String(e) },
      { status: 500 }
    );
  }
}
