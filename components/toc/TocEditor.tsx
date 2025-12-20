
"use client";

import React, { useEffect, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import Image from "@tiptap/extension-image";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { sanitizeEditorHTML } from "@/lib/editor/sanitize";

const PANEL =
  "w-full border rounded-lg px-3 py-2 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-200";

// ✅ style chung cho nút toolbar (nhỏ, nằm gọn 1 hàng)
const BTN_TOOL =
  "px-1.5 py-0.5 rounded border bg-white hover:bg-gray-100 disabled:opacity-50 text-xs";

type TocEditorProps = {
  value: string;
  canEdit: boolean;
  sectionTitle: string;
  sectionKindLabel: string;
  versionId: string;
  templateId?: string | null; // 👈 thêm để biết version đã có template chưa
  onChange: (html: string) => void;
};

function clsActive(active: boolean) {
  return active ? "bg-blue-100 border-blue-300" : "bg-white";
}

export function TocEditor({
  value,
  canEdit,
  sectionTitle,
  sectionKindLabel,
  onChange,
  versionId,
  templateId,
}: TocEditorProps) {
  // debounce output để tránh onChange spam quá nhiều
  const [tick, setTick] = useState(0);

  // Preview PDF state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4, 5] },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      Placeholder.configure({
        placeholder: "Nhập nội dung ở đây…",
      }),
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: value || "<p></p>",
    editable: canEdit,
    editorProps: {
      attributes: {
        class: `${PANEL} leading-relaxed text-sm ProseMirror`,
      },
      // “làm sạch” paste (Word/Docs)
      transformPastedHTML(html) {
        return sanitizeEditorHTML(html);
      },
    },
    onUpdate() {
      // debounce nhẹ
      setTick((t) => t + 1);
    },
  });

  // debounce xuất HTML sạch
  useEffect(() => {
    if (!editor) return;
    const id = window.setTimeout(() => {
      const clean = sanitizeEditorHTML(editor.getHTML());
      onChange(clean);
    }, 200);
    return () => window.clearTimeout(id);
  }, [tick, editor, onChange]);

  // sync khi đổi section
  useEffect(() => {
    if (!editor) return;
    const next = value || "<p></p>";
    const cur = sanitizeEditorHTML(editor.getHTML());
    const want = sanitizeEditorHTML(next);
    if (cur !== want) {
      editor.commands.setContent(want, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  // sync quyền edit
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(canEdit);
  }, [canEdit, editor]);

  // Toolbar helpers
  const canUse = !!editor && canEdit;

  const askLink = () => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Nhập link (https://...)", prev || "");
    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  const askImage = () => {
    if (!editor) return;
    const url = window.prompt("Nhập URL ảnh (https://... hoặc data:image/...)");
    if (!url?.trim()) return;
    editor.chain().focus().setImage({ src: url.trim() }).run();
  };

  async function openPreview() {
    setPreviewErr(null);

    // ❗ Guard: version chưa có template thì không cho gọi API
    if (!templateId) {
      setPreviewOpen(true);
      setPreviewUrl(null);
      setPreviewLoading(false);
      setPreviewErr(
        "Phiên bản này chưa được gán template dàn trang, nên không thể render PDF. Hãy vào trang xuất bản để chọn template trước."
      );
      return;
    }

    setPreviewOpen(true);

    // nếu đã có previewUrl còn hạn thì khỏi gọi lại
    if (previewUrl) return;

    setPreviewLoading(true);
    try {
      const res = await fetch("/api/books/version/render-pdf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version_id: versionId }),
      });

      const j = await res.json().catch(() => ({} as any));

      if (!res.ok || !j?.ok) {
        throw new Error(j?.error || j?.detail || `HTTP ${res.status}`);
      }

      setPreviewUrl(j.preview_url || null);
    } catch (e: any) {
      setPreviewErr(e?.message || "Preview lỗi");
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-lg">Nội dung: {sectionTitle}</h2>
          <p className="text-xs text-gray-500">
            Bạn đang chỉnh sửa phần {sectionKindLabel}.
          </p>
        </div>
        {canEdit ? (
          <span className="text-xs text-gray-500">
            Bạn có thể chỉnh sửa nội dung
          </span>
        ) : (
          <span className="text-xs text-gray-500">
            Bạn chỉ có quyền xem nội dung
          </span>
        )}
      </div>

      {/* Khung editor: toolbar sticky + body scroll */}
      <div className="rounded-lg border bg-white">
        {/* Toolbar */}
        <div className="sticky top-0 z-10 bg-gray-50 border-b rounded-t-lg px-3 py-2">
          <div
            className="
              flex flex-nowrap items-center gap-1
              text-xs
              overflow-x-auto whitespace-nowrap
              scrollbar-thin
            "
          >
            {/* ✅ Preview */}
            <button
              type="button"
              className={BTN_TOOL}
              disabled={previewLoading || !templateId}
              onClick={openPreview}
              title={
                templateId
                  ? "Xem thử khi in PDF theo template"
                  : "Phiên bản chưa có template dàn trang – không thể preview PDF"
              }
            >
              {previewLoading ? "Đang preview..." : "Preview PDF"}
            </button>

            <span className="h-6 w-px bg-gray-300 mx-1" />

            {/* Undo/Redo */}
            <button
              type="button"
              className={BTN_TOOL}
              disabled={!canUse || !editor?.can().undo()}
              onClick={() => editor?.chain().focus().undo().run()}
            >
              ↶
            </button>
            <button
              type="button"
              className={BTN_TOOL}
              disabled={!canUse || !editor?.can().redo()}
              onClick={() => editor?.chain().focus().redo().run()}
            >
              ↷
            </button>

            <span className="h-6 w-px bg-gray-300 mx-1" />

            {/* Inline marks */}
            <button
              type="button"
              className={`${BTN_TOOL} ${clsActive(
                !!editor?.isActive("bold")
              )}`}
              disabled={!canUse}
              onClick={() => editor?.chain().focus().toggleBold().run()}
            >
              B
            </button>
            <button
              type="button"
              className={`${BTN_TOOL} italic ${clsActive(
                !!editor?.isActive("italic")
              )}`}
              disabled={!canUse}
              onClick={() => editor?.chain().focus().toggleItalic().run()}
            >
              I
            </button>
            <button
              type="button"
              className={`${BTN_TOOL} underline ${clsActive(
                !!editor?.isActive("underline")
              )}`}
              disabled={!canUse}
              onClick={() => editor?.chain().focus().toggleUnderline().run()}
            >
              U
            </button>

            <span className="h-6 w-px bg-gray-300 mx-1" />

            {/* Lists */}
            <button
              type="button"
              className={`${BTN_TOOL} ${clsActive(
                !!editor?.isActive("bulletList")
              )}`}
              disabled={!canUse}
              onClick={() =>
                editor?.chain().focus().toggleBulletList().run()
              }
            >
              •
            </button>
            <button
              type="button"
              className={`${BTN_TOOL} ${clsActive(
                !!editor?.isActive("orderedList")
              )}`}
              disabled={!canUse}
              onClick={() =>
                editor?.chain().focus().toggleOrderedList().run()
              }
            >
              1.
            </button>

            <span className="h-6 w-px bg-gray-300 mx-1" />

            {/* Headings */}
            <button
              type="button"
              className={`${BTN_TOOL} ${clsActive(
                !!editor?.isActive("heading", { level: 2 })
              )}`}
              disabled={!canUse}
              onClick={() =>
                editor?.chain().focus().toggleHeading({ level: 2 }).run()
              }
            >
              H2
            </button>
            <button
              type="button"
              className={`${BTN_TOOL} ${clsActive(
                !!editor?.isActive("heading", { level: 3 })
              )}`}
              disabled={!canUse}
              onClick={() =>
                editor?.chain().focus().toggleHeading({ level: 3 }).run()
              }
            >
              H3
            </button>
            <button
              type="button"
              className={`${BTN_TOOL} ${clsActive(
                !!editor?.isActive("heading", { level: 4 })
              )}`}
              disabled={!canUse}
              onClick={() =>
                editor?.chain().focus().toggleHeading({ level: 4 }).run()
              }
            >
              H4
            </button>

            <span className="h-6 w-px bg-gray-300 mx-1" />

            {/* Align */}
            <button
              type="button"
              className={BTN_TOOL}
              disabled={!canUse}
              onClick={() =>
                editor?.chain().focus().setTextAlign("left").run()
              }
            >
              ⬅
            </button>
            <button
              type="button"
              className={BTN_TOOL}
              disabled={!canUse}
              onClick={() =>
                editor?.chain().focus().setTextAlign("center").run()
              }
            >
              ⬌
            </button>
            <button
              type="button"
              className={BTN_TOOL}
              disabled={!canUse}
              onClick={() =>
                editor?.chain().focus().setTextAlign("right").run()
              }
            >
              ➡
            </button>

            <span className="h-6 w-px bg-gray-300 mx-1" />

            {/* Link / Quote / Code */}
            <button
              type="button"
              className={`${BTN_TOOL} ${clsActive(
                !!editor?.isActive("link")
              )}`}
              disabled={!canUse}
              onClick={askLink}
            >
              🔗
            </button>
            <button
              type="button"
              className={`${BTN_TOOL} ${clsActive(
                !!editor?.isActive("blockquote")
              )}`}
              disabled={!canUse}
              onClick={() =>
                editor?.chain().focus().toggleBlockquote().run()
              }
            >
              ❝
            </button>
            <button
              type="button"
              className={`${BTN_TOOL} ${clsActive(
                !!editor?.isActive("codeBlock")
              )}`}
              disabled={!canUse}
              onClick={() =>
                editor?.chain().focus().toggleCodeBlock().run()
              }
            >
              {"</>"}
            </button>

            <span className="h-6 w-px bg-gray-300 mx-1" />

            {/* Table */}
            <button
              type="button"
              className={BTN_TOOL}
              disabled={!canUse}
              onClick={() =>
                editor
                  ?.chain()
                  .focus()
                  .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                  .run()
              }
            >
              ⊞
            </button>

            {/* Image */}
            <button
              type="button"
              className={BTN_TOOL}
              disabled={!canUse}
              onClick={askImage}
            >
              🖼
            </button>
          </div>
        </div>

        {/* Body scroll */}
        <div className="max-h-[520px] overflow-y-auto px-3 py-2">
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* ✅ Preview Modal */}
      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-5xl h-[85vh] bg-white rounded-lg shadow-lg border flex flex-col">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div className="font-semibold">
                Preview PDF (toàn chương/sách)
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-md border hover:bg-gray-50 text-sm"
                  onClick={() => {
                    setPreviewUrl(null);
                    openPreview();
                  }}
                  disabled={previewLoading || !templateId}
                >
                  Render lại
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-md border hover:bg-gray-50 text-sm"
                  onClick={() => setPreviewOpen(false)}
                >
                  Đóng
                </button>
              </div>
            </div>

            <div className="flex-1 p-3">
              {previewErr ? (
                <div className="text-sm text-red-600">{previewErr}</div>
              ) : previewLoading && !previewUrl ? (
                <div className="text-sm text-gray-600">
                  Đang render preview…
                </div>
              ) : previewUrl ? (
                <iframe
                  title="preview"
                  src={previewUrl}
                  className="w-full h-full rounded-md border"
                />
              ) : (
                <div className="text-sm text-gray-600">Chưa có preview.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
