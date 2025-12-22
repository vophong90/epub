// app/api/books/version/preview-item-pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRouteClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Preview PDF chỉ 1 chương (toc item)
 * - Không dùng cho xuất bản cả sách
 * - Author chỉ preview được chương họ được phân công (nếu bạn bật rule này)
 */
export async function POST(req: NextRequest) {
  const supabase = getRouteClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const user = auth.user;

  const body = (await req.json().catch(() => ({}))) as {
    version_id?: string;
    toc_item_id?: string;
  };

  const versionId = body.version_id?.trim() || "";
  const tocItemId = body.toc_item_id?.trim() || "";
  if (!versionId || !tocItemId) {
    return NextResponse.json(
      { ok: false, error: "version_id và toc_item_id là bắt buộc" },
      { status: 400 }
    );
  }

  // 1) Load profile để biết system_role (admin/editor...)
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, system_role")
    .eq("id", user.id)
    .maybeSingle();

  const isAdmin = profile?.system_role === "admin";

  // 2) Load version để lấy template_id + book_id
  // ⚠️ Sửa field cho đúng schema của bạn (mình dùng book_versions theo memory)
  const { data: version, error: vErr } = await supabase
    .from("book_versions")
    .select("id, book_id, template_id")
    .eq("id", versionId)
    .maybeSingle();

  if (vErr || !version) {
    return NextResponse.json({ ok: false, error: "Không tìm thấy version" }, { status: 404 });
  }

  if (!version.template_id) {
    return NextResponse.json(
      { ok: false, error: "Version chưa gán template dàn trang" },
      { status: 400 }
    );
  }

  // 3) Permission:
  // - Admin: ok
  // - Không admin: phải có book_permissions role author/editor (hoặc theo rule bạn muốn)
  if (!isAdmin) {
    const { data: perm } = await supabase
      .from("book_permissions")
      .select("role")
      .eq("book_id", version.book_id)
      .eq("user_id", user.id)
      .in("role", ["author", "editor"])
      .maybeSingle();

    if (!perm) {
      return NextResponse.json({ ok: false, error: "Bạn không có quyền với sách này" }, { status: 403 });
    }

    // ✅ (Tuỳ chọn mạnh hơn) Nếu bạn muốn: author chỉ preview được toc item họ được phân công
    // Hãy bật block dưới và sửa tên bảng/field theo schema phân công của bạn.
    /*
    const { data: assign } = await supabase
      .from("toc_assignments")
      .select("id")
      .eq("version_id", versionId)
      .eq("toc_item_id", tocItemId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!assign && perm.role !== "editor") {
      return NextResponse.json(
        { ok: false, error: "Bạn không được phân công chương này" },
        { status: 403 }
      );
    }
    */
  }

  // 4) Load template
  // ⚠️ Sửa table/fields cho đúng (mình dùng book_templates theo logic bạn đang làm ở phần templates)
  const { data: tpl, error: tErr } = await supabase
    .from("book_templates")
    .select(
      "id, name, page_size, page_margin_mm, css, header_html, footer_html, cover_html, front_matter_html, toc_html"
    )
    .eq("id", version.template_id)
    .maybeSingle();

  if (tErr || !tpl) {
    return NextResponse.json({ ok: false, error: "Không tìm thấy template" }, { status: 404 });
  }

  // 5) Load toc item content (CHỈ 1 CHƯƠNG)
  // ⚠️ Bạn sửa select field theo đúng nơi lưu HTML chương:
  // - nếu bạn lưu ở toc_items.content_html => giữ như dưới
  // - nếu lưu ở toc_item_contents => đổi sang bảng đó
  const { data: item, error: iErr } = await supabase
    .from("toc_items")
    .select("id, title, content_html, version_id")
    .eq("id", tocItemId)
    .maybeSingle();

  if (iErr || !item) {
    return NextResponse.json({ ok: false, error: "Không tìm thấy chương" }, { status: 404 });
  }

  // Nếu toc_items có version_id, bạn nên check khớp versionId để tránh preview nhầm
  if ((item as any).version_id && (item as any).version_id !== versionId) {
    return NextResponse.json({ ok: false, error: "Chương không thuộc version này" }, { status: 400 });
  }

  // 6) Build HTML: dùng template CSS/header/footer nhưng BODY chỉ có 1 chương
  // ✅ Bạn có thể tái sử dụng y nguyên đoạn "build HTML + paged.js" trong render-pdf route của bạn
  const chapterTitle = item.title || "Chương";
  const chapterHtml = (item as any).content_html || "<p></p>";

  const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Preview - ${escapeHtml(chapterTitle)}</title>
  <style>
    ${tpl.css || ""}
  </style>
</head>
<body>
  <!-- header/footer dùng running elements nếu template của bạn có -->
  <div id="__chapter">
    <h1>${escapeHtml(chapterTitle)}</h1>
    ${chapterHtml}
  </div>

  <!-- Nếu render-pdf của bạn dùng Paged.js, hãy copy đoạn script y hệt sang đây -->
</body>
</html>
`.trim();

  // 7) Render PDF buffer:
  // ✅ QUAN TRỌNG: bạn HÃY COPY y nguyên “engine render” đang dùng trong /render-pdf (puppeteer/chromium)
  // và thay input html = html ở trên.
  //
  // Ví dụ giả lập:
  // const pdfBuffer = await renderHtmlToPdfBuffer(html);
  //
  // Vì mình chưa thấy code render-pdf hiện tại của bạn trong tin nhắn này,
  // nên mình đặt placeholder function call.
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderHtmlToPdfBuffer_PLACEHOLDER(html);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Render preview thất bại", detail: e?.message || String(e) },
      { status: 500 }
    );
  }

  // 8) Upload lên bucket pdf_previews và trả signed url
  const pdfPath = `previews/${versionId}/${tocItemId}.pdf`;

  const { error: upErr } = await supabase.storage
    .from("pdf_previews")
    .upload(pdfPath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (upErr) {
    return NextResponse.json({ ok: false, error: "Upload preview thất bại", detail: upErr.message }, { status: 500 });
  }

  const { data: signed, error: sErr } = await supabase.storage
    .from("pdf_previews")
    .createSignedUrl(pdfPath, 60 * 30); // 30 phút

  if (sErr || !signed?.signedUrl) {
    return NextResponse.json({ ok: false, error: "Không tạo được signed url" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, preview_url: signed.signedUrl, path: pdfPath });
}

/** Helpers */
function escapeHtml(s: string) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * PLACEHOLDER:
 * 👉 Bạn hãy thay bằng render engine y hệt trong /api/books/version/render-pdf
 * (puppeteer/chromium/pagedjs) — chỉ khác là input html ở đây là 1 chương.
 */
async function renderHtmlToPdfBuffer_PLACEHOLDER(_html: string): Promise<Buffer> {
  throw new Error(
    "Bạn cần copy phần render PDF (puppeteer/chromium) từ route render-pdf sang đây."
  );
}
