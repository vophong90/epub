// components/toc/TocEditor.tsx
"use client";

import { useEffect, useRef } from "react";

const INPUT =
  "w-full border rounded-lg px-3 py-2 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-200";

type TocEditorProps = {
  value: string; // HTML hiện tại
  canEdit: boolean;
  sectionTitle: string;
  sectionKindLabel: string; // ví dụ: "chương chính" / "mục con"
  onChange: (html: string) => void;
};

type SavedSel = {
  range: Range | null;
};

export function TocEditor({
  value,
  canEdit,
  sectionTitle,
  sectionKindLabel,
  onChange,
}: TocEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const selRef = useRef<SavedSel>({ range: null });

  // sync HTML từ props vào editor
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const next = value || "<p></p>";
    if (el.innerHTML !== next) {
      el.innerHTML = next;
    }
  }, [value]);

  function isRangeInsideEditor(r: Range, editor: HTMLElement) {
    const c = r.commonAncestorContainer;
    return editor.contains(c.nodeType === 3 ? c.parentNode : c);
  }

  function saveSelection() {
    const el = editorRef.current;
    if (!el) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const r = sel.getRangeAt(0);
    if (!isRangeInsideEditor(r, el)) return;

    // clone để không bị browser mutate
    selRef.current.range = r.cloneRange();
  }

  function restoreSelection() {
    const el = editorRef.current;
    if (!el) return false;

    const r = selRef.current.range;
    if (!r) return false;

    // nếu range không còn nằm trong editor (do user click chỗ khác) thì thôi
    try {
      if (!isRangeInsideEditor(r, el)) return false;
      const sel = window.getSelection();
      if (!sel) return false;
      sel.removeAllRanges();
      sel.addRange(r);
      return true;
    } catch {
      return false;
    }
  }

  function exec(command: string, arg?: string) {
    if (!canEdit) return;
    const el = editorRef.current;
    if (!el) return;

    // focus + restore selection (cực quan trọng)
    el.focus();
    restoreSelection();

    try {
      if (arg !== undefined) {
        document.execCommand(command, false, arg);
      } else {
        document.execCommand(command, false);
      }
    } catch {
      // ignore
    }

    // cập nhật lại selection sau khi format
    saveSelection();

    onChange(el.innerHTML || "<p></p>");
  }

  // fallback list đơn giản nếu execCommand không tạo list (một số browser)
  function ensureList(type: "ul" | "ol") {
    const el = editorRef.current;
    if (!el) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const r = sel.getRangeAt(0);
    if (!isRangeInsideEditor(r, el)) return;

    // bọc selection thành <li>...
    const wrapper = document.createElement(type);
    const li = document.createElement("li");
    li.appendChild(r.extractContents());
    wrapper.appendChild(li);

    r.insertNode(wrapper);

    // move cursor vào cuối li
    const nr = document.createRange();
    nr.selectNodeContents(li);
    nr.collapse(false);
    sel.removeAllRanges();
    sel.addRange(nr);

    saveSelection();
    onChange(el.innerHTML || "<p></p>");
  }

  return (
    <div className="space-y-4">
      {/* Header nhỏ */}
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

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 text-sm border rounded-lg px-3 py-2 bg-gray-50">
        <button
          type="button"
          className="px-2 py-1 rounded hover:bg-gray-200 font-semibold"
          disabled={!canEdit}
          onMouseDown={(e) => {
            e.preventDefault();
            exec("bold");
          }}
        >
          B
        </button>
        <button
          type="button"
          className="px-2 py-1 rounded hover:bg-gray-200 italic"
          disabled={!canEdit}
          onMouseDown={(e) => {
            e.preventDefault();
            exec("italic");
          }}
        >
          I
        </button>
        <button
          type="button"
          className="px-2 py-1 rounded hover:bg-gray-200 underline"
          disabled={!canEdit}
          onMouseDown={(e) => {
            e.preventDefault();
            exec("underline");
          }}
        >
          U
        </button>

        <span className="h-6 w-px bg-gray-300 mx-1" />

        <button
          type="button"
          className="px-2 py-1 rounded hover:bg-gray-200"
          disabled={!canEdit}
          onMouseDown={(e) => {
            e.preventDefault();
            // thử execCommand trước
            exec("insertUnorderedList");
            // nếu không ra <ul> thì fallback
            const el = editorRef.current;
            if (el && !el.innerHTML.toLowerCase().includes("<ul")) {
              ensureList("ul");
            }
          }}
        >
          • Bullet
        </button>
        <button
          type="button"
          className="px-2 py-1 rounded hover:bg-gray-200"
          disabled={!canEdit}
          onMouseDown={(e) => {
            e.preventDefault();
            exec("insertOrderedList");
            const el = editorRef.current;
            if (el && !el.innerHTML.toLowerCase().includes("<ol")) {
              ensureList("ol");
            }
          }}
        >
          1.2.3
        </button>

        <span className="h-6 w-px bg-gray-300 mx-1" />

        <button
          type="button"
          className="px-2 py-1 rounded hover:bg-gray-200"
          disabled={!canEdit}
          onMouseDown={(e) => {
            e.preventDefault();
            // formatBlock nên dùng "<h2>" thay vì "H2"
            exec("formatBlock", "<h2>");
          }}
        >
          H2
        </button>
        <button
          type="button"
          className="px-2 py-1 rounded hover:bg-gray-200"
          disabled={!canEdit}
          onMouseDown={(e) => {
            e.preventDefault();
            exec("formatBlock", "<h3>");
          }}
        >
          H3
        </button>
      </div>

      {/* Vùng contentEditable */}
      <div
        ref={editorRef}
        className={`${INPUT} min-h-[280px] max-h-[520px] overflow-y-auto leading-relaxed text-sm`}
        contentEditable={canEdit}
        suppressContentEditableWarning
        onInput={(e) => {
          saveSelection();
          onChange(e.currentTarget.innerHTML);
        }}
        onMouseUp={() => saveSelection()}
        onKeyUp={() => saveSelection()}
        onFocus={() => saveSelection()}
      />
    </div>
  );
}
