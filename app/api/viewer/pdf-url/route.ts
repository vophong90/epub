// app/api/viewer/pdf-url/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getRouteClient } from "@/lib/supabaseServer";
import { getAdminClient } from "@/lib/supabase-admin";

const BUCKET = "published_pdfs";
const EXPIRES_SEC = 60 * 10;

type Visibility = "public_open" | "internal_only";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const book_id = url.searchParams.get("book_id");

    if (!book_id) {
      return NextResponse.json(
        { error: "book_id là bắt buộc" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();

    const { data: pub, error: pubErr } = await admin
      .from("book_publications")
      .select("pdf_path, published_at, version_id, visibility")
      .eq("book_id", book_id)
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

    const visibility: Visibility = pub.visibility ?? "public_open";

    // Chỉ kiểm tra đăng nhập khi thật sự cần
    let isLoggedIn = false;

    if (visibility === "internal_only") {
      const supabase = getRouteClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      isLoggedIn = !!user;

      if (!isLoggedIn) {
        return NextResponse.json(
          {
            error: "Tài liệu này thuộc phạm vi nội bộ. Bạn cần đăng nhập để xem PDF.",
            visibility,
          },
          { status: 401 }
        );
      }
    }

    const { data: signed, error: signErr } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(pub.pdf_path, EXPIRES_SEC);

    if (signErr || !signed?.signedUrl) {
      return NextResponse.json(
        {
          error: "Không tạo được signed url",
          detail: signErr?.message,
          visibility,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      url: signed.signedUrl,
      published_at: pub.published_at,
      version_id: pub.version_id,
      visibility,
      expires_in: EXPIRES_SEC,
      requires_login: visibility === "internal_only",
      is_logged_in: isLoggedIn,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Server error", detail: e?.message || String(e) },
      { status: 500 }
    );
  }
}
