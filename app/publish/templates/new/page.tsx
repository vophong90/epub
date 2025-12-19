// app/publish/templates/new/page.tsx
"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";

type MarginState = {
  top: string;
  right: string;
  bottom: string;
  left: string;
};

const DEFAULT_CSS = `/* ===== Fonts (Google Noto Serif) ===== */
@import url('https://fonts.googleapis.com/css2?family=Noto+Serif:wght@400;600;700&display=swap');

:root {
  --page-width: 210mm;
  --page-height: 297mm;
  --font-body: "Noto Serif", "Times New Roman", serif;
  --font-size-base: 11pt;
  --line-height-base: 1.4;
  --color-text: #111111;
  --color-muted: #666666;
  --color-accent: #0b7a3b;
}

/* Kích thước & lề trang – sẽ được override bằng @page */
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
    font-family: var(--font-body);
    font-size: 9pt;
    color: var(--color-muted);
  }
}

body {
  font-family: var(--font-body);
  font-size: var(--font-size-base);
  line-height: var(--line-height-base);
  color: var(--color-text);
  margin: 0;
}

/* ===== Cover ===== */
section.cover {
  page: cover;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100vh;
  text-align: center;
}

.cover-title {
  font-size: 26pt;
  font-weight: 700;
  margin-bottom: 0.5em;
}

.cover-subtitle {
  font-size: 14pt;
  color: var(--color-muted);
}

/* ===== Nội dung chính ===== */
main#book-content {
  counter-reset: chapter;
}

section.chapter {
  page-break-before: always;
}

h1.chapter-title {
  counter-increment: chapter;
  font-size: 18pt;
  margin-bottom: 0.5em;
}

h1.chapter-title::before {
  content: "Chương " counter(chapter) " – ";
  color: var(--color-accent);
}

/* Mục con */
h2 {
  font-size: 14pt;
  margin-top: 1.2em;
  margin-bottom: 0.4em;
}

h3 {
  font-size: 12pt;
  margin-top: 0.8em;
  margin-bottom: 0.3em;
}

/* ===== TOC ===== */
nav.toc {
  page-break-after: always;
}

nav.toc h1 {
  font-size: 16pt;
  margin-bottom: 0.5em;
}

nav.toc ol {
  list-style: none;
  padding-left: 0;
}

nav.toc li {
  display: flex;
  align-items: baseline;
  font-size: 11pt;
}

nav.toc li .dots {
  flex: 1;
  border-bottom: 1px dotted #999;
  margin: 0 4px;
}

nav.toc li .page {
  min-width: 24px;
  text-align: right;
}
`;

const DEFAULT_COVER_HTML = `<section class="cover" style="page-break-after:always;">
  <div>
    <div class="cover-subtitle">KHOA Y HỌC CỔ TRUYỀN</div>
    <h1 class="cover-title">{{BOOK_TITLE}}</h1>
    <div class="cover-subtitle">ĐẠI HỌC Y DƯỢC THÀNH PHỐ HỒ CHÍ MINH</div>
    <div style="margin-top:3em; font-size:11pt;">{{YEAR}}</div>
  </div>
</section>`;

const DEFAULT_FRONT_HTML = `<!-- Trang đầu / Lời nói đầu (tuỳ chỉnh thêm) -->
<section style="page-break-after:always;">
  <h1>Lời nói đầu</h1>
  <p>...</p>
</section>`;

const DEFAULT_TOC_HTML = `<nav class="toc">
  <h1>Mục lục</h1>
  <ol id="toc-list">
    <!-- JS sẽ tự fill nội dung -->
  </ol>
</nav>`;

const DEFAULT_HEADER_HTML = `<div class="runningHeaderLeft" id="running-left">
  {{BOOK_TITLE}}
</div>
<div class="runningHeaderRight" id="running-right">
  <!-- Sẽ được override theo từng chương -->
</div>`;

const DEFAULT_FOOTER_HTML = `<!-- footer dùng @bottom-center counter(page) trong @page -->`;

export default function NewTemplatePage() {
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();

  const [name, setName] = useState("A4 – Noto Serif – Chuẩn sách");
  const [description, setDescription] = useState(
    "Template sách A4, serif, có TOC in + header/footer theo chương."
  );
  const [pageSize, setPageSize] = useState("A4");
  const [margin, setMargin] = useState<MarginState>({
    top: "20",
    right: "18",
    bottom: "20",
    left: "18",
  });
  const [css, setCss] = useState(DEFAULT_CSS);
  const [coverHtml, setCoverHtml] = useState(DEFAULT_COVER_HTML);
  const [frontHtml, setFrontHtml] = useState(DEFAULT_FRONT_HTML);
  const [tocHtml, setTocHtml] = useState(DEFAULT_TOC_HTML);
  const [headerHtml, setHeaderHtml] = useState(DEFAULT_HEADER_HTML);
  const [footerHtml, setFooterHtml] = useState(DEFAULT_FOOTER_HTML);
  const [isActive, setIsActive] = useState(true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>("");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    setError("");
    setMessage("");
  }, [name, description, pageSize, margin, css]);

  if (authLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-10">
        <p className="text-gray-500">Đang tải...</p>
      </div>
    );
  }

  if (!user || profile?.system_role !== "admin") {
    return (
      <div className="max-w-5xl mx-auto px-4 py-10">
        <p className="text-red-600">
          Chỉ admin mới được tạo template sách.
        </p>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const top = parseFloat(margin.top) || 20;
      const right = parseFloat(margin.right) || 18;
      const bottom = parseFloat(margin.bottom) || 20;
      const left = parseFloat(margin.left) || 18;

      const page_margin_mm = {
        top,
        right,
        bottom,
        left,
      };

      const { data, error: insErr } = await supabase
        .from("book_templates")
        .insert({
          name: name.trim(),
          description: description.trim() || null,
          page_size: pageSize,
          page_margin_mm,
          css,
          cover_html: coverHtml,
          front_matter_html: frontHtml,
          toc_html: tocHtml,
          header_html: headerHtml,
          footer_html: footerHtml,
          is_active: isActive,
          created_by: user.id, // tránh lỗi NOT NULL
        })
        .select("id")
        .maybeSingle();

      if (insErr) {
        console.error("insert template error:", insErr);
        setError("Không tạo được template mới: " + insErr.message);
        return;
      }

      setMessage("Tạo template thành công.");
      // quay lại trang publish
      setTimeout(() => {
        router.push("/publish");
      }, 800);
    } catch (err: any) {
      console.error(err);
      setError("Lỗi không xác định khi tạo template.");
    } finally {
      setSaving(false);
    }
  }

  function handleMarginChange(field: keyof MarginState, value: string) {
    setMargin((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h1 className="text-2xl font-semibold">Tạo template sách mới</h1>
        <button
          type="button"
          onClick={() => router.push("/publish")}
          className="px-3 py-1.5 rounded-lg border text-sm hover:bg-gray-50"
        >
          ← Quay lại trang Xuất bản
        </button>
      </div>

      <p className="text-sm text-gray-600">
        Template gồm: thông tin cơ bản, lề trang, CSS dàn trang, HTML bìa, front
        matter, mục lục in, header/footer. Sau khi lưu, template sẽ xuất hiện
        trong danh sách chọn ở trang <b>Xuất bản</b>.
      </p>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          {message}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Thông tin cơ bản */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">1. Thông tin cơ bản</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Tên template</label>
              <input
                type="text"
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Khổ giấy</label>
              <select
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={pageSize}
                onChange={(e) => setPageSize(e.target.value)}
              >
                <option value="A4">A4 (210×297mm)</option>
                <option value="A5">A5</option>
                <option value="Letter">Letter</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Mô tả (tuỳ chọn)</label>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-3">
            <label className="text-sm font-medium flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Kích hoạt template này (cho phép chọn khi xuất bản)
            </label>
          </div>
        </section>

        {/* Lề trang */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">2. Lề trang (mm)</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(["top", "right", "bottom", "left"] as (keyof MarginState)[]).map(
              (field) => (
                <div key={field} className="space-y-1">
                  <label className="text-sm font-medium capitalize">
                    {field}
                  </label>
                  <input
                    type="number"
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={margin[field]}
                    onChange={(e) =>
                      handleMarginChange(field, e.target.value)
                    }
                  />
                </div>
              )
            )}
          </div>
          <p className="text-xs text-gray-500">
            Các giá trị này sẽ được lưu vào{" "}
            <code className="font-mono">page_margin_mm</code> và dùng trong
            CSS @page.
          </p>
        </section>

        {/* CSS */}
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">3. CSS dàn trang</h2>
          <p className="text-xs text-gray-500">
            Bao gồm @page, font, style cho cover, TOC, heading, v.v. Đã có mẫu
            sẵn cho A4 – Noto Serif.
          </p>
          <textarea
            className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
            rows={18}
            value={css}
            onChange={(e) => setCss(e.target.value)}
          />
        </section>

        {/* HTML bìa + front matter + TOC + header/footer */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">4. HTML bìa &amp; mục lục</h2>

          <div className="space-y-1">
            <label className="text-sm font-medium">
              Bìa (cover_html – dùng {{`{{BOOK_TITLE}}`}} và {{`{{YEAR}}`}})
            </label>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
              rows={6}
              value={coverHtml}
              onChange={(e) => setCoverHtml(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">
              Front matter (front_matter_html)
            </label>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
              rows={5}
              value={frontHtml}
              onChange={(e) => setFrontHtml(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">
              Mục lục in (toc_html – bắt buộc có <code>ol#toc-list</code>)
            </label>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
              rows={5}
              value={tocHtml}
              onChange={(e) => setTocHtml(e.target.value)}
            />
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">5. Header &amp; Footer</h2>

          <div className="space-y-1">
            <label className="text-sm font-medium">
              Header (header_html – dùng{" "}
              <code>runningHeaderLeft</code> / <code>runningHeaderRight</code>)
            </label>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
              rows={4}
              value={headerHtml}
              onChange={(e) => setHeaderHtml(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">
              Footer (footer_html – thường để trống, dùng counter(page) trong
              CSS)
            </label>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
              rows={3}
              value={footerHtml}
              onChange={(e) => setFooterHtml(e.target.value)}
            />
          </div>
        </section>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Đang lưu..." : "Lưu template"}
          </button>

          <button
            type="button"
            onClick={() => router.push("/publish")}
            className="text-sm text-gray-600 hover:underline"
          >
            Huỷ và quay lại
          </button>
        </div>
      </form>
    </div>
  );
}
