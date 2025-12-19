import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4.1-mini"; // nếu bạn muốn đổi model, đổi ở đây

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Thiếu OPENAI_API_KEY trong môi trường Vercel" },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const text = String(body.text || "").trim();

    if (!text) {
      return NextResponse.json(
        { error: "text là bắt buộc" },
        { status: 400 }
      );
    }

    const prompt = `
Bạn là biên tập viên tiếng Việt cho sách y khoa.
Hãy kiểm tra đoạn văn sau và trả lời bằng tiếng Việt, ngắn gọn, với cấu trúc:

1) Tóm tắt nội dung (1–2 câu).
2) Các lỗi/điểm cần chú ý (gạch đầu dòng: chính tả, ngữ pháp, dấu câu, từ ngữ, logic, phong cách học thuật).
3) Gợi ý chỉnh sửa (đưa ra 1 phiên bản gợi ý đã chỉnh sửa, giữ nguyên ý chính).

Đoạn văn cần kiểm tra (có thể có HTML, hãy bỏ qua tag và chỉ xét nội dung chữ):

"""${text}"""
    `.trim();

    const res = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: "Bạn là trợ lý biên tập sách y khoa." },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 800,
      }),
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      return NextResponse.json(
        {
          error: "OpenAI trả về lỗi",
          detail: json,
        },
        { status: 500 }
      );
    }

    const feedback =
      json?.choices?.[0]?.message?.content ||
      JSON.stringify(json);

    return NextResponse.json({ ok: true, feedback });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: "Lỗi server khi gọi OpenAI",
        detail: e?.message || String(e),
      },
      { status: 500 }
    );
  }
}
