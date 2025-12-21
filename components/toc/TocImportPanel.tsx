// components/toc/TocImportPanel.tsx
"use client";

import { useState, ChangeEvent } from "react";
import { BTN_SM, BTN_SM_PRIMARY } from "./tocButtonStyles";

type ImportPreviewSubsection = {
  title: string;
  html: string;
};

type ImportPreview = {
  rootHtml: string;
  subsections: ImportPreviewSubsection[];
};

type TocImportPanelProps = {
  tocItemId: string;
  canImport: boolean; // thường là canEditContent && canManageSubsections
  onImportedSuccessfully?: () => void; // cho parent reload chương
};

export function TocImportPanel({
  tocItemId,
  canImport,
  onImportedSuccessfully,
}: TocImportPanelProps) {
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [replaceExistingSubs, setReplaceExistingSubs] = useState(true);
  const [importLoading, setImportLoading] = useState(false);
  const [importApplying, setImportApplying] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] || null;
    setImportFile(f);
    setImportPreview(null);
    setImportError(null);
  }

  async function handleImportPreview() {
    if (!tocItemId) return;
    if (!importFile) {
      setImportError("Vui lòng chọn file .docx trước.");
      return;
    }
    setImportLoading(true);
    setImportError(null);
    setImportPreview(null);
    try {
      const form = new FormData();
      form.append("file", importFile);
      form.append("toc_item_id", tocItemId);

      const res = await fetch("/api/toc/import-docx/preview", {
        method: "POST",
        body: form,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setImportError(j.error || "Không parse được file Word.");
      } else {
        const preview: ImportPreview = {
          rootHtml: j.rootHtml || "<p></p>",
          subsections: Array.isArray(j.subsections) ? j.subsections : [],
        };
        setImportPreview(preview);
      }
    } catch (e: any) {
      setImportError(e?.message || "Lỗi khi upload / parse file Word.");
    } finally {
      setImportLoading(false);
    }
  }

  async function handleImportApply() {
    if (!tocItemId || !importPreview) return;
    setImportApplying(true);
    setImportError(null);
    try {
      const res = await fetch("/api/toc/import-docx/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toc_item_id: tocItemId,
          rootHtml: importPreview.rootHtml,
          subsections: importPreview.subsections,
          replaceExisting: replaceExistingSubs,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setImportError(j.error || "Không áp dụng được nội dung từ Word.");
        return;
      }

      // notify parent reload chương + tụi mục con
      onImportedSuccessfully?.();

      // clear state
      setImportPreview(null);
      setImportFile(null);
    } catch (e: any) {
      setImportError(e?.message || "Lỗi khi áp dụng dữ liệu từ Word.");
    } finally {
      setImportApplying(false);
    }
  }

  if (!canImport) return null;

  return (
    <section className="mt-4 border-t border-slate-200 pt-4 space-y-3">
      <h4 className="text-sm font-semibold text-slate-800">
        Import nội dung từ file Word (.docx)
      </h4>
      <p className="text-xs text-slate-600">
        Dùng khi bạn đã có bản thảo chương trong Word với heading chuẩn. Hệ thống
        sẽ đọc nội dung, tách thành chương + mục con theo heading, cho xem trước,
        sau đó mới ghi vào DB.
      </p>

      <div className="flex flex-col md:flex-row gap-3 md:items-center">
        <input
          type="file"
          accept=".docx"
          onChange={handleFileChange}
          className="text-xs"
        />

        <button
          className={BTN_SM}
          onClick={handleImportPreview}
          disabled={importLoading || !importFile}
        >
          {importLoading ? "Đang đọc file Word..." : "Xem trước nội dung từ Word"}
        </button>

        {importPreview && (
          <button
            className={BTN_SM_PRIMARY}
            onClick={handleImportApply}
            disabled={importApplying}
          >
            {importApplying ? "Đang áp dụng..." : "Áp dụng vào chương này"}
          </button>
        )}
      </div>

      {importPreview && (
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <label className="inline-flex items-center gap-1">
            <input
              type="checkbox"
              className="rounded border-slate-300"
              checked={replaceExistingSubs}
              onChange={(e) => setReplaceExistingSubs(e.target.checked)}
            />
            Xoá toàn bộ mục con hiện tại và tạo lại từ file Word
          </label>
        </div>
      )}

      {importError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {importError}
        </div>
      )}

      {importPreview && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="space-y-2">
            <h5 className="font-semibold text-slate-800">
              Xem trước nội dung chương (root)
            </h5>
            <div className="border rounded-lg bg-white p-3 max-h-72 overflow-auto text-sm">
              <div
                dangerouslySetInnerHTML={{
                  __html: importPreview.rootHtml || "<p></p>",
                }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <h5 className="font-semibold text-slate-800">
              Các mục con sẽ được tạo ({importPreview.subsections.length})
            </h5>
            <div className="border rounded-lg bg-white p-3 max-h-72 overflow-auto space-y-3 text-sm">
              {importPreview.subsections.length === 0 && (
                <p className="text-xs text-slate-500">
                  Không có mục con nào được phát hiện từ heading.
                </p>
              )}

              {importPreview.subsections.map((s, idx) => (
                <div
                  key={`${idx}-${s.title}`}
                  className="border-b border-slate-100 pb-2 last:border-b-0"
                >
                  <div className="font-semibold text-slate-800 mb-1">
                    {idx + 1}. {s.title || "(Không tiêu đề)"}
                  </div>
                  <div
                    className="prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{
                      __html: s.html || "<p></p>",
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
