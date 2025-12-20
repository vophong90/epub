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

export function TocEditor({
  value,
  canEdit,
  sectionTitle,
  sectionKindLabel,
  onChange,
}: TocEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);

  // sync HTML từ props vào editor
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (el.innerHTML !== (value || "<p></p>")) {
      el.innerHTML = value || "<p></p>";
    }
  }, [value]);

  function exec(command: string, arg?: string) {
    if (!canEdit) return;
    const el = editorRef.current;
    if (!el) return;

    // giữ selection trong editor
    el.focus();
    try {
      if (arg !== undefined) {
        document.execCommand(command, false, arg);
      } else {
        document.execCommand(command, false);
      }
    } catch {
      // execCommand có thể bị warning trên browser mới, nhưng vẫn chạy được
    }

    const html = el.innerHTML;
    onChange(html);
  }

  return (
    <div className="space-y-4">
      {/* Header nhỏ */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-lg">
            Nội dung: {sectionTitle}
          </h2>
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
            exec("insertUnorderedList");
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
            exec("formatBlock", "H2");
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
            exec("formatBlock", "H3");
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
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
      />
    </div>
  );
}
