// app/api/toc/import-docx/preview/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../_helpers";
import mammoth from "mammoth";
import { parse } from "node-html-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SectionPreview = {
  title: string;
  html: string;
  order_index: number;
};

function cleanHtml(html: string): string {
  const trimmed = (html || "").trim();
  return trimmed || "<p></p>";
}

function getNodeText(node: any): string {
  const raw = (node.text ?? node.rawText ?? "") as string;
  return raw.replace(/\s+/g, " ").trim();
}

/** Heuristic: đoán heading khi không có H2 */
function looksLikeHeadingText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.length > 120) return false; // heading thường không quá dài

  // 1) Dạng đánh số: 1., 1.1., 2.3.4 ...
  if (/^\d+(\.\d+)*\s+/.test(t)) return true;

  // 2) Dạng số La Mã: I., II., III.
  if (/^[IVXLCDM]+\.\s+/.test(t)) return true;

  // 3) Chủ yếu là CHỮ HOA
  const letters = t.replace(/[^A-Za-zÀ-ỹ]/g, "");
  if (!letters) return false;
  const upperLetters = letters.replace(/[^A-ZÀ-Ỹ]/g, "");
  const ratio = upperLetters.length / letters.length;
  if (ratio >= 0.9) return true;

  return false;
}

/** Bỏ phần đánh số đầu heading, trả về tiêu đề sạch */
function stripHeadingNumber(text: string): string {
  let t = text.trim();

  // 1) Dạng 1., 1.1., 2.3.4 ...
  t = t.replace(/^\d+(\.\d+)*\s+/, "");

  // 2) Dạng (1) hoặc 1) + khoảng trắng
  t = t.replace(/^\(?\d+\)\s+/, "");

  // 3) Dạng số La Mã: I., II., III. ...
  t = t.replace(/^[IVXLCDM]+\.\s+/, "");

  t = t.trim();
  return t || text.trim();
}

/** Tách theo H2 – ưu tiên nếu file có Heading 2 */
function buildFromH2(body: any): { rootHtml: string; sections: SectionPreview[] } {
  const children = body.childNodes || [];
  const sections: { title: string; nodes: any[] }[] = [];
  const rootNodes: any[] = [];

  let currentSection: { title: string; nodes: any[] } | null = null;

  for (const node of children) {
    // bỏ text node trống
    const txt = getNodeText(node);
    if (!txt) continue;

    const tag = (node.tagName || "").toLowerCase();
    if (tag === "h2") {
      const rawTitle = txt || "Mục không có tiêu đề";
      const title = stripHeadingNumber(rawTitle) || "Mục không có tiêu đề";

      // bắt đầu section mới
      currentSection = { title, nodes: [] };
      sections.push(currentSection);
    } else {
      if (!currentSection) {
        rootNodes.push(node);
      } else {
        currentSection.nodes.push(node);
      }
    }
  }

  const rootHtml = cleanHtml(rootNodes.map((n) => n.toString()).join(""));

  const mapped: SectionPreview[] = sections.map((s, idx) => ({
    title: s.title,
    html: cleanHtml(s.nodes.map((n) => n.toString()).join("")),
    order_index: idx + 1,
  }));

  return { rootHtml, sections: mapped };
}

function buildFromHeuristic(body: any): { rootHtml: string; sections: SectionPreview[] } {
  const children = body.childNodes || [];
  const sections: { title: string; nodes: any[] }[] = [];
  const rootNodes: any[] = [];

  let currentSection: { title: string; nodes: any[] } | null = null;

  for (const node of children) {
    const txt = getNodeText(node);
    if (!txt) continue;

    const tag = (node.tagName || "").toLowerCase();

    const isCandidateHeading =
      tag === "h1" ||
      tag === "h3" ||
      tag === "p" ||
      tag === "div";

    const isHeading = isCandidateHeading && looksLikeHeadingText(txt);

    if (isHeading) {
      const rawTitle = txt || "Mục không có tiêu đề";
      const title = stripHeadingNumber(rawTitle) || "Mục không có tiêu đề";

      // bắt đầu section mới
      currentSection = { title, nodes: [] };
      sections.push(currentSection);
    } else {
      if (!currentSection) {
        rootNodes.push(node);
      } else {
        currentSection.nodes.push(node);
      }
    }
  }

  const rootHtml = cleanHtml(rootNodes.map((n) => n.toString()).join(""));

  const mapped: SectionPreview[] = sections.map((s, idx) => ({
    title: s.title,
    html: cleanHtml(s.nodes.map((n) => n.toString()).join("")),
    order_index: idx + 1,
  }));

  return { rootHtml, sections: mapped };
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireUser();
  if (error) return error;
  if (!user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Không đọc được dữ liệu form" },
      { status: 400 }
    );
  }

  const file = formData.get("file") as unknown as File | null;
  if (!file) {
    return NextResponse.json(
      { error: "Thiếu file .docx (field name: file)" },
      { status: 400 }
    );
  }

  const name = (file.name || "").toLowerCase();
  if (!name.endsWith(".docx")) {
    return NextResponse.json(
      { error: "Chỉ hỗ trợ file .docx" },
      { status: 400 }
    );
  }

  // Đọc file vào buffer
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Chuyển sang HTML bằng mammoth
  const result = await mammoth.convertToHtml({ buffer });
  const html = result.value || "";

  const root = parse(html);
  const body = root.querySelector("body") ?? root;

  // 1) ƯU TIÊN: tách theo Heading 2
  const hasH2 = !!body.querySelector("h2");
  if (hasH2) {
    const built = buildFromH2(body);

    // Nếu vì lý do gì đó mà không ra section, fallback heuristic
    if (built.sections.length > 0) {
      return NextResponse.json({
        ok: true,
        rootHtml: built.rootHtml,
        subsections: built.sections,
        info: {
          mode: "h2",
          fromHeadingStyles: true,
          sectionCount: built.sections.length,
        },
      });
    }
  }

  // 2) FALLBACK: heuristic khi không có H2
  const builtHeuristic = buildFromHeuristic(body);
  if (builtHeuristic.sections.length > 0) {
    return NextResponse.json({
      ok: true,
      rootHtml: builtHeuristic.rootHtml,
      subsections: builtHeuristic.sections,
      info: {
        mode: "heuristic",
        fromHeadingStyles: false,
        sectionCount: builtHeuristic.sections.length,
      },
    });
  }

  // 3) Không tách được gì: báo lỗi như cũ
  return NextResponse.json(
    {
      error:
        "Không tìm thấy cấu trúc heading phù hợp. File có thể không dùng Heading 2 hoặc tiêu đề không đủ rõ để nhận diện tự động.",
      noHeading2: true,
    },
    { status: 400 }
  );
}
