// app/publish/templates/new/page.tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";

type Margin = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

type FormState = {
  name: string;
  description: string;
  page_size: string;
  page_margin_mm: Margin;
  css: string;
  cover_html: string;
  front_matter_html: string;
  toc_html: string;
  header_html: string;
  footer_html: string;
  is_active: boolean;
};

const DEFAULT_MARGIN: Margin = {
  top: 20,
  right: 18,
  bottom: 20,
  left: 18,
};

const DEFAULT_CSS = `/* ===== Page setup ===== */
@page {
  size: A4;
  margin-top: 20mm;
  margin-bottom: 20mm;
  margin-left: 18mm;
  margin-right: 18mm;

  @top-left {
    content: element(runningHeaderLeft);
  }

  @top-right {
    content: element(runningHeaderRight);
  }

  @bottom-center {
    content: counter(page);
    font-size: 10px;
  }
}

/* ===== Global ===== */
html, body {
  margin: 0;
  padding: 0;
}

body {
  font-family: "Times New Roman", serif;
  font-size: 12pt;
  line-height: 1.5;
}

/* Cover */
section.cover {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100vh;
  text-align: center;
  page-break-after: always;
}

section.cover h1 {
  font-size: 26pt;
  margin-bottom: 1rem;
}

section.cover h2 {
  font-size: 16pt;
  margin-top: 0;
}

/* Front matter */
section.front-matter {
  page-break-after: always;
}

/* TOC */
nav.toc {
  page-break-after: always;
}

nav.toc h1 {
  font-size: 16pt;
  margin-bottom: 1rem;
}

nav.toc ol {
  list-style: none;
  padding-left: 0;
}

nav.toc li {
  display: flex;
  align-items: baseline;
  font-size: 11pt;
  margin: 2px 0;
}

nav.toc li a {
  flex: 1 1 auto;
  text-decoration: none;
  color: inherit;
}

/* dotted line giữa title và page */
nav.toc li .dots {
  flex: 0 0 auto;
  border-bottom: 1px dotted #aaa;
  margin: 0 4px;
  height: 0;
}

nav.toc li .page {
  flex: 0 0 auto;
  min-width: 24px;
  text-align: right;
}

/* Chapters */
section.chapter {
  page-break-before: always;
}

h1.chapter-title {
  font-size: 18pt;
  margin-bottom: 0.75rem;
}

h2, h3 {
  margin-top: 0.75rem;
  margin-bottom: 0.25rem;
}`.trim();

const DEFAULT_COVER = `<section class="cover">
  <h1>{{BOOK_TITLE}}</h1>
  <h2>Khoa Y học cổ truyền</h2>
  <p>Đại học Y Dược TP. Hồ Chí Minh</p>
  <p>{{YEAR}}</p>
</section>`.trim();

const DEFAULT_FRONT = `<section class="front-matter">
  <h1>Lời nói đầu</h1>
  <p>...</p>
</section>`.trim();

const DEFAULT_TOC = `<nav class="toc">
  <h1>Mục lục</h1>
  <ol id="toc-list">
    <!-- JS sẽ fill các <li> tại đây -->
  </ol>
</nav>`.trim();

const DEFAULT_HEADER = `<div class="runningHeaderLeft" id="running-left">
  {{BOOK_TITLE}}
</div>`.trim();

const DEFAULT_HEADER_RIGHT = `<div class="runningHeaderRight" id="running-right">
  <!-- Sẽ được override theo từng chương bằng running element -->
</div>`.trim();

const DEFAULT_FOOTER = `<!-- footer dùng @bottom-center counter(page) trong @page -->`.trim();

export default function NewTemplatePage() {
  const router = useRouter();
  const { user, profile, loading } = useAuth();

  const [form, setForm] = useState<FormState>({
    name: "A4 – Noto Serif – Chuẩn sách",
    description: "Template sách A4, serif, có TOC in + header/footer theo chương",
    page_size: "A4",
    page_margin_mm: { ...DEFAULT_MARGIN },
    css: DEFAULT_CSS,
    cover_html: DEFAULT_COVER,
    front_matter_html: DEFAULT_FRONT,
    toc_html: DEFAULT_TOC,
    header_html: DEFAULT_HEADER + "\n\n" + DEFAULT_HEADER_RIGHT,
    footer_html: DEFAULT_FOOTER,
    is_active: true,
  });

  const [saving, setSaving] = useState(false);

  // Chỉ admin được truy cập
  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login?redirectTo=/publish/templates/new");
      return;
    }
    if (profile?.system_role !== "admin") {
      router.replace("/");
    }
  }, [user, profile, loading, router]);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateMargin(part: keyof Margin, value: string) {
    const n = parseInt(value, 10);
    const mm = Number.isFinite(n) ? n : 0;
    setForm((prev) => ({
      ...prev,
      page_margin_mm: {
        ...prev.page_margin_mm,
        [part]: mm,
      },
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      alert("Tên template là bắt buộc");
      return;
    }

    try {
      setSaving(true);
      const res = await fetch("/api/book-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        console.error("create template error:", j.error || res.status);
        alert(j.error || "Tạo template thất bại");
        return;
      }
      alert("Đã tạo template mới");
      router.push("/publish");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !user || profile?.system_role !== "admin") {
    return (
      <main className="max-w-5xl mx-auto px-4 py-6">
        <p className="text-sm text-gray-600">Đang kiểm tra quyền truy cập…</p>
      </main>
    );
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Tạo template sách mới</h1>
        <button
          type="button"
          className="text-sm text-blue-600 hover:underline"
          onClick={() => router.push("/publish")}
        >
          ← Quay lại trang Xuất bản
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Thông tin chung */}
        <section className="border rounded-lg p-4 space-y-4 bg-gray-50/60">
          <h2 className="text-sm font-semibold text-gray-800">
            Thông tin template
          </h2>

          <div className="space-y-1">
            <label className="text-sm font-medium">Tên template</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
              placeholder="Ví dụ: A4 – Serif – Chuẩn sách"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Mô tả</label>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm"
              rows={2}
              value={form.description}
              onChange={(e) => updateField("description", e.target.value)}
              placeholder="Ghi chú mục đích sử dụng template này…"
            />
          </div>

          <div className="flex flex-wrap gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Khổ giấy</label>
              <select
                className="border rounded-lg px-3 py-2 text-sm"
                value={form.page_size}
                onChange={(e) => updateField("page_size", e.target.value)}
              >
                <option value="A4">A4</option>
                <option value="A5">A5</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Kích hoạt (is_active)</label>
              <div className="flex items-center gap-2 text-sm">
                <input
                  id="is_active"
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => updateField("is_active", e.target.checked)}
                />
                <label htmlFor="is_active">Dùng được ngay</label>
              </div>
            </div>
          </div>
        </section>

        {/* Lề trang */}
        <section className="border rounded-lg p-4 space-y-4 bg-gray-50/60">
          <h2 className="text-sm font-semibold text-gray-800">
            Lề trang (page_margin_mm)
          </h2>
          <p className="text-xs text-gray-500">
            Đơn vị: mm. Dùng cho @page nếu anh muốn đọc ở backend.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="text-sm">Trên (top)</label>
              <input
                type="number"
                className="w-full border rounded-lg px-2 py-1.5 text-sm"
                value={form.page_margin_mm.top}
                onChange={(e) => updateMargin("top", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm">Phải (right)</label>
              <input
                type="number"
                className="w-full border rounded-lg px-2 py-1.5 text-sm"
                value={form.page_margin_mm.right}
                onChange={(e) => updateMargin("right", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm">Dưới (bottom)</label>
              <input
                type="number"
                className="w-full border rounded-lg px-2 py-1.5 text-sm"
                value={form.page_margin_mm.bottom}
                onChange={(e) => updateMargin("bottom", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm">Trái (left)</label>
              <input
                type="number"
                className="w-full border rounded-lg px-2 py-1.5 text-sm"
                value={form.page_margin_mm.left}
                onChange={(e) => updateMargin("left", e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* CSS */}
        <section className="border rounded-lg p-4 space-y-3 bg-gray-50/60">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-800">
              CSS (paged.js, @page, running header/footer)
            </h2>
            <button
              type="button"
              className="text-xs text-blue-600 hover:underline"
              onClick={() => updateField("css", DEFAULT_CSS)}
            >
              Reset về mặc định
            </button>
          </div>

          <textarea
            className="w-full border rounded-lg px-3 py-2 text-xs font-mono leading-snug"
            rows={16}
            value={form.css}
            onChange={(e) => updateField("css", e.target.value)}
          />
        </section>

        {/* HTML blocks */}
        <section className="border rounded-lg p-4 space-y-4 bg-gray-50/60">
          <h2 className="text-sm font-semibold text-gray-800">
            Các block HTML (cover, front matter, TOC, header, footer)
          </h2>

          <p className="text-xs text-gray-500">
            Có thể dùng token{" "}
            <code className="px-1 rounded bg-gray-200 text-[11px]">
              {"{{BOOK_TITLE}}"}
            </code>{" "}
            và{" "}
            <code className="px-1 rounded bg-gray-200 text-[11px]">
              {"{{YEAR}}"}
            </code>{" "}
            – backend sẽ thay trước khi render.
          </p>

          {/* Cover */}
          <div className="space-y-1">
            <label className="text-sm font-medium">
              Bìa (cover_html – dùng{" "}
              <code className="px-1 rounded bg-gray-200 text-[11px]">
                {"{{BOOK_TITLE}}"}
              </code>{" "}
              và{" "}
              <code className="px-1 rounded bg-gray-200 text-[11px]">
                {"{{YEAR}}"}
              </code>
              )
            </label>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
              rows={6}
              value={form.cover_html}
              onChange={(e) => updateField("cover_html", e.target.value)}
            />
          </div>

          {/* Front matter */}
          <div className="space-y-1">
            <label className="text-sm font-medium">
              Front matter (front_matter_html)
            </label>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
              rows={5}
              value={form.front_matter_html}
              onChange={(e) => updateField("front_matter_html", e.target.value)}
            />
          </div>

          {/* TOC */}
          <div className="space-y-1">
            <label className="text-sm font-medium">
              Mục lục (toc_html – cần có{" "}
              <code className="px-1 rounded bg-gray-200 text-[11px]">
                {"<ol id=\"toc-list\">"}
              </code>
              )
            </label>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
              rows={5}
              value={form.toc_html}
              onChange={(e) => updateField("toc_html", e.target.value)}
            />
          </div>

          {/* Header */}
          <div className="space-y-1">
            <label className="text-sm font-medium">
              Header (header_html – dùng running elements)
            </label>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
              rows={5}
              value={form.header_html}
              onChange={(e) => updateField("header_html", e.target.value)}
            />
          </div>

          {/* Footer */}
          <div className="space-y-1">
            <label className="text-sm font-medium">
              Footer (footer_html – thường để trống, dùng counter(page) trong
              @page)
            </label>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
              rows={3}
              value={form.footer_html}
              onChange={(e) => updateField("footer_html", e.target.value)}
            />
          </div>
        </section>

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            className="px-3 py-2 rounded-lg border text-sm text-gray-700 hover:bg-gray-50"
            onClick={() => router.push("/publish")}
          >
            Hủy
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? "Đang lưu…" : "Lưu template"}
          </button>
        </div>
      </form>
    </main>
  );
}
