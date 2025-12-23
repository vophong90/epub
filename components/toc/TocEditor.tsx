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

// ✨ Word-like
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import CharacterCount from "@tiptap/extension-character-count";

import { sanitizeEditorHTML } from "@/lib/editor/sanitize";
import { BTN_SM, BTN_SM_PRIMARY } from "./tocButtonStyles";

const PANEL =
  "w-full border rounded-lg px-3 py-2 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-200";

// ✅ style chung cho nút toolbar (nhỏ, nằm gọn 1 hàng)
const BTN_TOOL =
  "px-1.5 py-0.5 rounded border bg-white hover:bg-gray-100 disabled:opacity-50 text-xs";

// helpers escape đơn giản
function escHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type TocEditorProps = {
  value: string;
  canEdit: boolean;
  sectionTitle: string;
  sectionKindLabel: string;
  versionId: string;
  tocItemId: string; // ✅ NEW: để preview đúng chương đang mở
  templateId?: string | null; // để biết version đã có template chưa
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
  tocItemId,
  templateId,
}: TocEditorProps) {
  // debounce output để tránh onChange spam quá nhiều
  const [tick, setTick] = useState(0);

  // Preview PDF state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  // màu chữ hiện tại (để hiển thị trên input color)
  const [currentColor, setCurrentColor] = useState<string>("#000000");
  // màu highlight hiện tại (không bắt buộc nhưng cho đồng nhất UX)
  const [currentHighlight, setCurrentHighlight] = useState<string>("#ffff00");

  // Footnote counter
  const [footnoteCounter, setFootnoteCounter] = useState(1);

  // Find & Replace state
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [replaceInfo, setReplaceInfo] = useState<string | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4, 5] },
        // StarterKit đã có strike, blockquote, codeBlock, list...
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

      // ✨ Word-like
      TextStyle,
      Color.configure({
        types: ["textStyle"],
      }),
      Highlight,
      TaskList.configure({
        HTMLAttributes: { class: "tiptap-task-list" },
      }),
      TaskItem.configure({
        nested: true,
        HTMLAttributes: { class: "tiptap-task-item" },
      }),
      HorizontalRule,
      Superscript,
      Subscript,
      CharacterCount.configure({
        // không giới hạn, chỉ để đếm
      }),
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

      // cập nhật màu đang chọn (để sync với color input)
      const attrs = editor.getAttributes("textStyle");
      if (attrs?.color) {
        setCurrentColor(attrs.color);
      }
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

  // ✅ reset cache preview khi đổi chương/version/template
  useEffect(() => {
    setPreviewUrl(null);
    setPreviewErr(null);
    setPreviewLoading(false);
  }, [tocItemId, versionId, templateId]);

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

  // Hình + alt-text + caption
  const askImage = () => {
    if (!editor) return;
    const url = window.prompt("Nhập URL ảnh (https://... hoặc data:image/...)");
    if (!url?.trim()) return;
    const alt = window.prompt("Mô tả (alt-text) cho hình (có thể bỏ trống)") || "";
    const caption =
      window.prompt("Chú thích hình (caption, có thể bỏ trống)") || "";

    const src = url.trim();
    const altEsc = escHtml(alt.trim());
    const capEsc = escHtml(caption.trim());

    if (!caption && !alt) {
      // đơn giản: ảnh thường
      editor
        .chain()
        .focus()
        .setImage({ src, alt: altEsc || undefined })
        .run();
    } else {
      const figHtml = `<figure class="figure">
  <img src="${escHtml(src)}" alt="${altEsc}" />
  ${
    capEsc
      ? `<figcaption><strong>Hình.</strong> ${capEsc}</figcaption>`
      : ""
  }
</figure>`;
      editor.chain().focus().insertContent(figHtml).run();
    }
  };

  // Caption bảng (đặt gần bảng)
  const insertTableCaption = () => {
    if (!editor) return;
    const cap =
      window.prompt("Nhập chú thích bảng (vd: \"Đặc điểm chung của mẫu nghiên cứu\")") ||
      "";
    if (!cap.trim()) return;
    const capEsc = escHtml(cap.trim());
    const html = `<p><strong>Bảng.</strong> ${capEsc}</p>`;
    editor.chain().focus().insertContent(html).run();
  };

  const clearFormatting = () => {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .unsetAllMarks()
      .clearNodes()
      .run();
  };

  const onColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!editor) return;
    const color = e.target.value;
    setCurrentColor(color);
    editor.chain().focus().setColor(color).run();
  };

  const onHighlightToggle = () => {
    if (!editor) return;
    // toggle highlight, dùng màu hiện tại
    editor
      .chain()
      .focus()
      .toggleHighlight({ color: currentHighlight })
      .run();
  };

  const onTaskListToggle = () => {
    if (!editor) return;
    editor.chain().focus().toggleTaskList().run();
  };

  const increaseIndent = () => {
    if (!editor) return;
    editor.chain().focus().sinkListItem("listItem").run();
  };

  const decreaseIndent = () => {
    if (!editor) return;
    editor.chain().focus().liftListItem("listItem").run();
  };

  // Math inline/block: chèn LaTeX dạng \(...\) hoặc \[...\]
  const insertMathInline = () => {
    if (!editor) return;
    const latex = window.prompt("Nhập biểu thức LaTeX (inline), không gồm \\( \\)") || "";
    if (!latex.trim()) return;
    const content = `\\(${latex.trim()}\\)`;
    editor.chain().focus().insertContent(content + " ").run();
  };

  const insertMathBlock = () => {
    if (!editor) return;
    const latex = window.prompt("Nhập công thức LaTeX (block), không gồm \\[ \\]") || "";
    if (!latex.trim()) return;
    const html = `<p>\\[${escHtml(latex.trim())}\\]</p>`;
    editor.chain().focus().insertContent(html).run();
  };

  // Footnote: chèn số tham chiếu dạng sup [1], [2]...
  const insertFootnoteRef = () => {
    if (!editor) return;
    const n = footnoteCounter;
    setFootnoteCounter(n + 1);
    editor.chain().focus().insertContent(`<sup>[${n}]</sup>`).run();
  };

  // Callout: Key point / Pearl / Cảnh báo / Ghi nhớ
  const insertCallout = (type: "keypoint" | "pearl" | "warning" | "note") => {
    if (!editor) return;
    let label = "";
    switch (type) {
      case "keypoint":
        label = "Key point";
        break;
      case "pearl":
        label = "Clinical pearl";
        break;
      case "warning":
        label = "Cảnh báo";
        break;
      case "note":
        label = "Ghi nhớ";
        break;
    }
    const html = `<blockquote class="callout callout-${type}">
  <strong>${label}:</strong> Nội dung tóm tắt sẽ viết ở đây...
</blockquote>`;
    editor.chain().focus().insertContent(html).run();
  };

  // Find & Replace: thay tất cả trên HTML
  const handleReplaceAll = () => {
    if (!editor) return;
    const find = findText;
    if (!find.trim()) {
      setReplaceInfo("Vui lòng nhập chuỗi cần tìm.");
      return;
    }
    const html = editor.getHTML();
    const re = new RegExp(escapeRegExp(find), "g");
    const matches = html.match(re);
    const count = matches ? matches.length : 0;
    if (count === 0) {
      setReplaceInfo("Không tìm thấy chuỗi cần thay.");
      return;
    }
    const newHtml = html.replace(re, replaceText);
    editor.commands.setContent(newHtml, false);
    setReplaceInfo(`Đã thay ${count} lần.`);
    setTick((t) => t + 1);
  };

  async function openPreview(force = false) {
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

    if (!tocItemId) {
      setPreviewOpen(true);
      setPreviewUrl(null);
      setPreviewLoading(false);
      setPreviewErr("Thiếu tocItemId nên không xác định được chương để preview.");
      return;
    }

    setPreviewOpen(true);

    // nếu đã có previewUrl còn hạn thì khỏi gọi lại (trừ khi force)
    if (previewUrl && !force) return;

    setPreviewLoading(true);
    try {
      const res = await fetch("/api/books/version/preview-item-pdf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version_id: versionId, toc_item_id: tocItemId }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      // 🚀 Lấy PDF dạng blob, tạo object URL để nhúng vào iframe
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      // nếu trước đó đã có URL cũ thì revoke cho đỡ rò bộ nhớ
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      setPreviewUrl(url);
    } catch (e: any) {
      setPreviewErr(e?.message || "Preview lỗi");
    } finally {
      setPreviewLoading(false);
    }
  }

  const wordCount =
    editor?.storage?.characterCount?.words?.() ??
    editor?.storage?.characterCount?.words ??
    0;
  const charCount =
    editor?.storage?.characterCount?.characters?.() ??
    editor?.storage?.characterCount?.characters ??
    0;

  const inTable = !!editor?.isActive("table");

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
          <span className="text-xs text-gray-500">Bạn có thể chỉnh sửa nội dung</span>
        ) : (
          <span className="text-xs text-gray-500">Bạn chỉ có quyền xem nội dung</span>
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
              onClick={() => openPreview(false)}
              title={
                templateId
                  ? "Xem thử PDF cho chương hiện tại theo template"
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
              className={`${BTN_TOOL} ${clsActive(!!editor?.isActive("bold"))}`}
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
            {/* Strikethrough */}
            <button
              type="button"
              className={`${BTN_TOOL} line-through ${clsActive(
                !!editor?.isActive("strike")
              )}`}
              disabled={!canUse}
              onClick={() => editor?.chain().focus().toggleStrike().run()}
            >
              S
            </button>
            {/* Superscript / Subscript */}
            <button
              type="button"
              className={`${BTN_TOOL} ${clsActive(
                !!editor?.isActive("superscript")
              )}`}
              disabled={!canUse}
              onClick={() => editor?.chain().focus().toggleSuperscript().run()}
              title="Superscript"
            >
              x²
            </button>
            <button
              type="button"
              className={`${BTN_TOOL} ${clsActive(
                !!editor?.isActive("subscript")
              )}`}
              disabled={!canUse}
              onClick={() => editor?.chain().focus().toggleSubscript().run()}
              title="Subscript"
            >
              x₂
            </button>

            {/* Clear formatting */}
            <button
              type="button"
              className={BTN_TOOL}
              disabled={!canUse}
              onClick={clearFormatting}
              title="Xóa định dạng"
            >
              Tx
            </button>

            <span className="h-6 w-px bg-gray-300 mx-1" />

            {/* Màu chữ & Highlight */}
            <label className="inline-flex items-center gap-1">
              <span className="text-[10px] text-gray-500">Màu</span>
              <input
                type="color"
                value={currentColor}
                onChange={onColorChange}
                disabled={!canUse}
                className="w-6 h-4 border rounded cursor-pointer"
              />
            </label>
            <button
              type="button"
              className={`${BTN_TOOL} ${clsActive(!!editor?.isActive("highlight"))}`}
              disabled={!canUse}
              onClick={onHighlightToggle}
              title="Tô nền"
            >
              HL
            </button>

            <span className="h-6 w-px bg-gray-300 mx-1" />

            {/* Lists */}
            <button
              type="button"
              className={`${BTN_TOOL} ${clsActive(
                !!editor?.isActive("bulletList")
              )}`}
              disabled={!canUse}
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
            >
              •
            </button>
            <button
              type="button"
              className={`${BTN_TOOL} ${clsActive(
                !!editor?.isActive("orderedList")
              )}`}
              disabled={!canUse}
              onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            >
              1.
            </button>
            <button
              type="button"
              className={`${BTN_TOOL} ${clsActive(
                !!editor?.isActive("taskList")
              )}`}
              disabled={!canUse}
              onClick={onTaskListToggle}
              title="Danh sách checkbox"
            >
              ☑
            </button>

            {/* Indent / Outdent cho list */}
            <button
              type="button"
              className={BTN_TOOL}
              disabled={!canUse || !editor?.can().sinkListItem("listItem")}
              onClick={increaseIndent}
              title="Tăng thụt đầu dòng"
            >
              ⇥
            </button>
            <button
              type="button"
              className={BTN_TOOL}
              disabled={!canUse || !editor?.can().liftListItem("listItem")}
              onClick={decreaseIndent}
              title="Giảm thụt đầu dòng"
            >
              ⇤
            </button>

            <span className="h-6 w-px bg-gray-300 mx-1" />

            {/* Headings */}
            <button
              type="button"
              className={`${BTN_TOOL} ${clsActive(
                !!editor?.isActive("heading", { level: 2 })
              )}`}
              disabled={!canUse}
              onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
            >
              H2
            </button>
            <button
              type="button"
              className={`${BTN_TOOL} ${clsActive(
                !!editor?.isActive("heading", { level: 3 })
              )}`}

              disabled={!canUse}
              onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
            >
              H3
            </button>
            <button
              type="button"
              className={`${BTN_TOOL} ${clsActive(
                !!editor?.isActive("heading", { level: 4 })
              )}`}
              disabled={!canUse}
              onClick={() => editor?.chain().focus().toggleHeading({ level: 4 }).run()}
            >
              H4
            </button>

            <span className="h-6 w-px bg-gray-300 mx-1" />

            {/* Align */}
            <button
              type="button"
              className={BTN_TOOL}
              disabled={!canUse}
              onClick={() => editor?.chain().focus().setTextAlign("left").run()}
            >
              ⬅
            </button>
            <button
              type="button"
              className={BTN_TOOL}
              disabled={!canUse}
              onClick={() => editor?.chain().focus().setTextAlign("center").run()}
            >
              ⬌
            </button>
            <button
              type="button"
              className={BTN_TOOL}
              disabled={!canUse}
              onClick={() => editor?.chain().focus().setTextAlign("right").run()}
            >
              ➡
            </button>
            {/* Justify */}
            <button
              type="button"
              className={BTN_TOOL}
              disabled={!canUse}
              onClick={() => editor?.chain().focus().setTextAlign("justify").run()}
              title="Căn đều hai bên"
            >
              ≡
            </button>

            <span className="h-6 w-px bg-gray-300 mx-1" />

            {/* Link / Quote / Code / HR */}
            <button
              type="button"
              className={`${BTN_TOOL} ${clsActive(!!editor?.isActive("link"))}`}
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
              onClick={() => editor?.chain().focus().toggleBlockquote().run()}
            >
              ❝
            </button>
            <button
              type="button"
              className={`${BTN_TOOL} ${clsActive(
                !!editor?.isActive("codeBlock")
              )}`}
              disabled={!canUse}
              onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
            >
              {"</>"}
            </button>
            <button
              type="button"
              className={BTN_TOOL}
              disabled={!canUse}
              onClick={() => editor?.chain().focus().setHorizontalRule().run()}
              title="Kẻ đường ngang"
            >
              ─
            </button>

            <span className="h-6 w-px bg-gray-300 mx-1" />

            {/* Math / Footnote */}
            <button
              type="button"
              className={BTN_TOOL}
              disabled={!canUse}
              onClick={insertMathInline}
              title="Math inline (\\(...\\))"
            >
              M₁
            </button>
            <button
              type="button"
              className={BTN_TOOL}
              disabled={!canUse}
              onClick={insertMathBlock}
              title="Math block (\\[...\\])"
            >
              M₂
            </button>
            <button
              type="button"
              className={BTN_TOOL}
              disabled={!canUse}
              onClick={insertFootnoteRef}
              title="Chèn footnote ref"
            >
              FN
            </button>

            <span className="h-6 w-px bg-gray-300 mx-1" />

            {/* Callout: Key point / Pearl / Cảnh báo / Ghi nhớ */}
            <button
              type="button"
              className={BTN_TOOL}
              disabled={!canUse}
              onClick={() => insertCallout("keypoint")}
              title="Key point"
            >
              KP
            </button>
            <button
              type="button"
              className={BTN_TOOL}
              disabled={!canUse}
              onClick={() => insertCallout("pearl")}
              title="Clinical pearl"
            >
              PL
            </button>
            <button
              type="button"
              className={BTN_TOOL}
              disabled={!canUse}
              onClick={() => insertCallout("warning")}
              title="Cảnh báo"
            >
              ⚠
            </button>
            <button
              type="button"
              className={BTN_TOOL}
              disabled={!canUse}
              onClick={() => insertCallout("note")}
              title="Ghi nhớ"
            >
              📝
            </button>

            <span className="h-6 w-px bg-gray-300 mx-1" />

            {/* Table & Table toolbar */}
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
              title="Chèn bảng 3x3"
            >
              ⊞
            </button>
            <button
              type="button"
              className={BTN_TOOL}
              disabled={!canUse}
              onClick={insertTableCaption}
              title="Chèn caption cho bảng"
            >
              TblCap
            </button>

            {/* Bảng: chỉnh sửa cấu trúc (chỉ hoạt động khi đang ở trong bảng) */}
            <div className="inline-flex items-center gap-0.5 ml-1">
              <button
                type="button"
                className={BTN_TOOL}
                disabled={!canUse || !inTable}
                onClick={() => editor?.chain().focus().addRowBefore().run()}
                title="Thêm hàng phía trên"
              >
                +R↑
              </button>
              <button
                type="button"
                className={BTN_TOOL}
                disabled={!canUse || !inTable}
                onClick={() => editor?.chain().focus().addRowAfter().run()}
                title="Thêm hàng phía dưới"
              >
                +R↓
              </button>
              <button
                type="button"
                className={BTN_TOOL}
                disabled={!canUse || !inTable}
                onClick={() => editor?.chain().focus().deleteRow().run()}
                title="Xóa hàng"
              >
                −R
              </button>
              <button
                type="button"
                className={BTN_TOOL}
                disabled={!canUse || !inTable}
                onClick={() => editor?.chain().focus().addColumnBefore().run()}
                title="Thêm cột bên trái"
              >
                +C←
              </button>
              <button
                type="button"
                className={BTN_TOOL}
                disabled={!canUse || !inTable}
                onClick={() => editor?.chain().focus().addColumnAfter().run()}
                title="Thêm cột bên phải"
              >
                +C→
              </button>
              <button
                type="button"
                className={BTN_TOOL}
                disabled={!canUse || !inTable}
                onClick={() => editor?.chain().focus().deleteColumn().run()}
                title="Xóa cột"
              >
                −C
              </button>
              <button
                type="button"
                className={BTN_TOOL}
                disabled={!canUse || !inTable}
                onClick={() => editor?.chain().focus().mergeCells().run()}
                title="Merge ô"
              >
                ⊔
              </button>
              <button
                type="button"
                className={BTN_TOOL}
                disabled={!canUse || !inTable}
                onClick={() => editor?.chain().focus().splitCell().run()}
                title="Tách ô"
              >
                ⊟
              </button>
              <button
                type="button"
                className={BTN_TOOL}
                disabled={!canUse || !inTable}
                onClick={() => editor?.chain().focus().toggleHeaderRow().run()}
                title="Toggle hàng header"
              >
                H↕
              </button>
            </div>

            <span className="h-6 w-px bg-gray-300 mx-1" />

            {/* Image */}
            <button
              type="button"
              className={BTN_TOOL}
              disabled={!canUse}
              onClick={askImage}
              title="Chèn hình (alt + caption)"
            >
              🖼
            </button>

            <span className="h-6 w-px bg-gray-300 mx-1" />

            {/* Find & Replace */}
            <button
              type="button"
              className={`${BTN_TOOL} ${findOpen ? "bg-blue-50 border-blue-300" : ""}`}
              disabled={!canUse}
              onClick={() => setFindOpen((v) => !v)}
              title="Tìm & Thay thế"
            >
              F/R
            </button>
          </div>

          {/* Find & Replace bar */}
          {findOpen && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <div className="flex items-center gap-1">
                <span className="text-gray-500">Tìm:</span>
                <input
                  type="text"
                  value={findText}
                  onChange={(e) => setFindText(e.target.value)}
                  className="border rounded px-1 py-0.5 text-xs"
                  placeholder="chuỗi cần tìm"
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-gray-500">Thay bằng:</span>
                <input
                  type="text"
                  value={replaceText}
                  onChange={(e) => setReplaceText(e.target.value)}
                  className="border rounded px-1 py-0.5 text-xs"
                  placeholder="chuỗi thay thế"
                />
              </div>
              <button
                type="button"
                className={BTN_TOOL}
                disabled={!canUse}
                onClick={handleReplaceAll}
              >
                Thay tất cả
              </button>
              {replaceInfo && (
                <span className="text-[11px] text-gray-500">{replaceInfo}</span>
              )}
            </div>
          )}
        </div>

        {/* Body scroll */}
        <div className="max-h-[520px] overflow-y-auto px-3 py-2">
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Status bar: Word / Char count */}
      <div className="flex items-center justify-between text-[11px] text-gray-500">
        <div>
          {typeof wordCount === "number" && typeof charCount === "number" ? (
            <span>
              {wordCount} từ · {charCount} ký tự
            </span>
          ) : (
            <span>Đang tính số từ...</span>
          )}
        </div>
      </div>

      {/* ✅ Preview Modal */}
      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-5xl h-[85vh] bg-white rounded-lg shadow-lg border flex flex-col">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div className="font-semibold">Preview PDF (chương hiện tại)</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={BTN_SM_PRIMARY}
                  onClick={() => openPreview(true)}
                  disabled={previewLoading || !templateId}
                >
                  Render lại
                </button>

                <button
                  type="button"
                  className={BTN_SM}
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
                <div className="text-sm text-gray-600">Đang render preview…</div>
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
