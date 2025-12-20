// app/api/toc/import-docx/preview/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../_helpers";
import * as mammoth from "mammoth";
import { parse } from "node-html-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PreviewSection = {
  title: string;
  html: string;
};

function normalizeHtml(html: string) {
  // Dọn khoảng trắng & nbsp đơn giản
  return (html || "").replace(/\u00a0/g, " ").trim();
}

/**
 * Rule import:
 * - H1 (nếu có) coi như tiêu đề tài liệu, bỏ qua (không tạo mục con).
 * - H2 = mục con trực tiếp của chương.
 * - Nội dung của 1 H2 = tất cả node sau nó cho đến H2 kế tiếp.
 * - RootHtml = tất cả node trước H2 đầu tiên.
 */
export async function POST(req: NextRequest) {
  // Chỉ cho user đã đăng nhập dùng, cho chắc
  const { error } = await requireUser();
  if (error) return error;

  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Thiếu file .docx" }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".docx")) {
      return NextResponse.json({ error: "Chỉ hỗ trợ file .docx" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());

    // 1) Chuyển docx -> HTML
    const { value: htmlRaw } = await mammoth.convertToHtml({ buffer: buf });
    const html = normalizeHtml(htmlRaw);

    if (!html) {
      return NextResponse.json(
        { error: "Không đọc được nội dung từ file Word" },
        { status: 400 }
      );
    }

    // 2) Parse HTML, tách root / các H2
    const root = parse(`<div id="__root__">${html}</div>`);
    const container = root.querySelector("#__root__");
    const children = container ? container.childNodes : [];

    let rootParts: string[] = [];
    let current: { title: string; parts: string[] } | null = null;
    const subsections: PreviewSection[] = [];

    const pushCurrent = () => {
      if (!current) return;
      const body = current.parts.join("").trim();
      subsections.push({
        title: current.title.trim() || "Mục không tên",
        html: body || "<p></p>",
      });
      current = null;
    };

    for (const n of children) {
      const el: any = n as any;
      const tag = el.tagName ? String(el.tagName).toUpperCase() : "";

      if (tag === "H2") {
        // Bắt đầu mục con mới
        pushCurrent();
        const title = (el.text || "").toString().trim() || "Mục không tên";
        current = { title, parts: [] };
        continue;
      }

      if (tag === "H1") {
        // H1 coi là tiêu đề tài liệu, không đẩy vào nội dung
        continue;
      }

      const nodeHtml = el.toString ? String(el.toString()) : "";
      if (!nodeHtml) continue;

      if (!current) rootParts.push(nodeHtml);
      else current.parts.push(nodeHtml);
    }

    pushCurrent();

    const rootHtml = rootParts.join("").trim() || "<p></p>";

    if (!subsections.length) {
      return NextResponse.json(
        {
          error:
            "Không tìm thấy Heading 2 (H2). File có thể chưa dùng Heading styles. " +
            "Vui lòng chỉnh lại Heading trong Word trước khi import.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      rootHtml,
      subsections,
      meta: {
        filename: file.name,
        count: subsections.length,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Lỗi khi đọc file Word" },
      { status: 500 }
    );
  }
}
