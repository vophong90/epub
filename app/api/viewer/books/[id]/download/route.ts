// app/api/viewer/books/[id]/download/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { getAdminClient } from "@/lib/supabase-admin";

const BUCKET = "published_pdfs";
const EXPIRES_SEC = 60; // link tải ngắn hơn

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const bookId = id;

    if (!bookId) {
      return NextResponse.json(
        { error: "Thiếu book id" },
        { status: 400 }
      );
    }

    const supa = createRouteHandlerClient({ cookies });
    const {
      data: { user },
      error: authErr,
    } = await supa.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json(
        { error: "Bạn cần đăng nhập để tải PDF" },
        { status: 401 }
      );
    }

    const admin = getAdminClient();

    const { data: pub, error: pubErr } = await admin
      .from("book_publications")
      .select("pdf_path")
      .eq("book_id", bookId)
      .eq("is_active", true)
      .maybeSingle();

    if (pubErr) {
      return NextResponse.json(
        { error: "Lỗi đọc publication", detail: pubErr.message },
        { status: 500 }
      );
    }

    if (!pub?.pdf_path) {
      return NextResponse.json(
        { error: "Sách chưa được publish PDF" },
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
        {
          error: "Không tạo được link tải",
          detail: signErr?.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.redirect(signed.signedUrl);
  } catch (e: any) {
    return NextResponse.json(
      { error: "Server error", detail: e?.message || String(e) },
      { status: 500 }
    );
  }
}
