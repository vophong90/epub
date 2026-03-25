export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase-admin";

const DEFAULT_PREVIEW_BUCKET = "published_previews";
const EXPIRES_SEC = 60 * 5;

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: Params) {
  try {
    const { id: bookId } = await context.params;
    if (!bookId) {
      return NextResponse.json({ error: "Thiếu book id" }, { status: 400 });
    }

    const admin = getAdminClient();

    const { data: pub, error } = await admin
      .from("book_publications")
      .select(
        "book_id, is_active, visibility, preview_bucket, preview_prefix, preview_page_count"
      )
      .eq("book_id", bookId)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: "Lỗi đọc publication", detail: error.message },
        { status: 500 }
      );
    }

    if (!pub) {
      return NextResponse.json(
        { error: "Không tìm thấy publication hoạt động" },
        { status: 404 }
      );
    }

    const previewBucket = pub.preview_bucket || DEFAULT_PREVIEW_BUCKET;
    const previewPrefix = pub.preview_prefix;
    const pageCount = Number(pub.preview_page_count || 0);

    if (!previewPrefix || pageCount <= 0) {
      return NextResponse.json(
        { error: "Chưa có preview pages cho sách này" },
        { status: 404 }
      );
    }

    const paths = Array.from({ length: pageCount }, (_, i) => {
      const page = i + 1;
      const file = `page-${String(page).padStart(3, "0")}.webp`;
      return `${previewPrefix}/${file}`;
    });

    const { data: signed, error: signErr } = await admin.storage
      .from(previewBucket)
      .createSignedUrls(paths, EXPIRES_SEC);

    if (signErr || !signed) {
      return NextResponse.json(
        {
          error: "Không tạo được signed urls cho preview",
          detail: signErr?.message,
        },
        { status: 500 }
      );
    }

    const pages = signed.map((item, idx) => ({
      page: idx + 1,
      path: paths[idx],
      url: item.signedUrl || null,
    }));

    return NextResponse.json({
      book_id: bookId,
      preview_bucket: previewBucket,
      preview_prefix: previewPrefix,
      page_count: pageCount,
      pages,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Server error", detail: e?.message || String(e) },
      { status: 500 }
    );
  }
}
