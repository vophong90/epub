// app/books/[id]/BookHeaderSection.tsx
"use client";

import Link from "next/link";

const BTN =
  "inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50";
const BTN_PRIMARY =
  "inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50";
const BTN_SECONDARY =
  "inline-flex items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50";

export type Book = {
  id: string;
  title: string;
  unit_name: string | null;
  created_at: string | null;
};

export type BookVersion = {
  id: string;
  book_id?: string;
  version_no: number;
  status: string;
  created_at: string | null;
  created_by?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  locked_by?: string | null;
  locked_at?: string | null;
  template_id?: string | null;
};

export type BookTemplate = {
  id: string;
  name: string;
  description: string | null;
  page_size: string;
  page_margin_mm: any;
  is_active: boolean;
  created_by: string;
  created_at: string;
};

export type BookHeaderSectionProps = {
  book: Book;

  /** version đang được chọn/hiển thị (thường là latest) */
  version: BookVersion | null;

  /** danh sách template */
  templates: BookTemplate[];
  templatesLoading: boolean;
  templatesError: string | null;

  /** state chọn template */
  selectedTemplateId: string;
  savingTemplate: boolean;

  /** state tạo version */
  creatingVersion: boolean;

  /** có bản published để clone hay không (page.tsx tính giúp) */
  hasPublishedVersion: boolean;

  /** handlers */
  onCreateFirstVersion: () => void;
  onCloneFromPublished: () => void;

  onChangeTemplate: (id: string) => void;
  onSaveTemplateForVersion: () => void;
};

function formatDateTime(dt: string | null | undefined) {
  if (!dt) return "";
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return dt;
  return d.toLocaleString("vi-VN");
}

const SELECT =
  "w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400";

export function BookHeaderSection(props: BookHeaderSectionProps) {
  const {
    book,
    version,
    templates,
    templatesLoading,
    templatesError,
    selectedTemplateId,
    savingTemplate,
    creatingVersion,
    hasPublishedVersion,
    onCreateFirstVersion,
    onCloneFromPublished,
    onChangeTemplate,
    onSaveTemplateForVersion,
  } = props;

  const currentTemplate =
    version?.template_id && templates.length
      ? templates.find((t) => t.id === version.template_id) || null
      : null;

  const canCloneNewVersion = Boolean(version) && hasPublishedVersion;

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500">
        <Link href="/books" className="hover:underline">
          Sách của tôi
        </Link>{" "}
        / <span className="text-gray-700">{book.title}</span>
      </div>

      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-2 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold">{book.title}</h1>
          <p className="text-sm text-gray-500">Đơn vị: {book.unit_name || "—"}</p>

          {version && (
            <p className="mt-1 text-sm text-gray-500">
              Phiên bản {version.version_no} –{" "}
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                {version.status}
              </span>{" "}
              · Tạo lúc {formatDateTime(version.created_at)}
              {version.template_id ? (
                <span className="ml-2 text-xs text-gray-500">
                  · Template:{" "}
                  <span className="font-medium text-gray-700">
                    {currentTemplate?.name || "Đã gán"}
                  </span>
                </span>
              ) : (
                <span className="ml-2 text-xs text-gray-500">
                  · Template: <span className="font-medium">Chưa chọn</span>
                </span>
              )}
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <Link href="/books" className={BTN}>
            ← Quay lại danh sách
          </Link>

          {/* ✅ Khi đã có version và có published -> cho tạo version mới bằng clone */}
          {canCloneNewVersion ? (
            <button
              className={BTN_SECONDARY}
              onClick={onCloneFromPublished}
              disabled={creatingVersion}
              title="Tạo phiên bản nháp mới bằng cách clone từ bản đã publish gần nhất"
            >
              {creatingVersion ? "Đang tạo phiên bản…" : "Tạo phiên bản mới"}
            </button>
          ) : null}
        </div>
      </div>

      {/* Nếu chưa có version → nút tạo phiên bản đầu tiên */}
      {!version && (
        <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-800">
            Sách này chưa có phiên bản nào. Bạn cần tạo phiên bản đầu tiên trước khi
            xây dựng mục lục.
          </p>
          <button
            className={BTN_PRIMARY}
            onClick={onCreateFirstVersion}
            disabled={creatingVersion}
          >
            {creatingVersion ? "Đang tạo phiên bản…" : "Tạo phiên bản đầu tiên"}
          </button>
        </div>
      )}

      {/* Khi đã có version → selector template */}
      {version && (
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            {/* Left: title */}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-gray-900">
                Template cho phiên bản
              </div>
              <div className="text-xs text-gray-500 truncate">
                {templatesLoading
                  ? "Đang tải templates…"
                  : templatesError
                  ? templatesError
                  : selectedTemplateId
                  ? `Đã chọn: ${
                      templates.find((x) => x.id === selectedTemplateId)?.name || "—"
                    }`
                  : "Chưa chọn template"}
              </div>
            </div>

            {/* Middle: select */}
            <div className="w-full md:w-[520px]">
              <select
                className={SELECT}
                value={selectedTemplateId}
                onChange={(e) => onChangeTemplate(e.target.value)}
                disabled={templatesLoading || savingTemplate}
              >
                <option value="">(Chưa chọn / None)</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.page_size ? ` · ${t.page_size}` : ""}
                  </option>
                ))}
              </select>
              {templatesError ? (
                <div className="mt-1 text-[11px] text-red-600">{templatesError}</div>
              ) : null}
            </div>

            {/* Right: save */}
            <div className="shrink-0">
              <button
                className={BTN_PRIMARY}
                onClick={onSaveTemplateForVersion}
                disabled={savingTemplate || templatesLoading}
                title="Lưu template"
              >
                {savingTemplate ? "Đang lưu…" : "Lưu template"}
              </button>
            </div>
          </div>

          {/* Hint nhỏ khi chưa có published để clone */}
          {!hasPublishedVersion ? (
            <div className="mt-3 text-xs text-gray-500">
              * Chỉ hiện nút “Tạo phiên bản mới” khi sách có ít nhất 1 phiên bản ở trạng thái{" "}
              <span className="font-medium">published</span>.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
