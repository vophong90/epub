// components/toc/TocTreeSidebar.tsx
"use client";

import { FormEvent, useMemo, useState } from "react";

const INPUT =
  "w-full border rounded-lg px-3 py-2 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-200";

export type TocSidebarItem = {
  id: string;
  title: string;
  order_index: number;
};

type Props = {
  chapterTitle: string;
  items: TocSidebarItem[];
  activeSectionId: string; // "root" | string (page.tsx đang set "root")
  canManageSubsections: boolean;
  loading: boolean;

  onSelectSection: React.Dispatch<React.SetStateAction<string>>;

  onCreateSub: (title: string) => Promise<void> | void;
  onRenameSub: (id: string, newTitle: string) => Promise<void> | void;
  onDeleteSub: (id: string) => Promise<void> | void;
};

export function TocTreeSidebar({
  chapterTitle,
  items,
  activeSectionId,
  canManageSubsections,
  loading,
  onSelectSection,
  onCreateSub,
  onRenameSub,
  onDeleteSub,
}: Props) {
  // rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [renamingSaving, setRenamingSaving] = useState(false);

  // create state
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const sorted = useMemo(() => {
    return (items || []).slice().sort((a, b) => a.order_index - b.order_index);
  }, [items]);

  async function submitRename(e: FormEvent, id: string) {
    e.preventDefault();
    const t = renamingTitle.trim();
    if (!t || renamingSaving) return;

    setRenamingSaving(true);
    try {
      await onRenameSub(id, t);
      setRenamingId(null);
      setRenamingTitle("");
    } finally {
      setRenamingSaving(false);
    }
  }

  async function submitCreate(e: FormEvent) {
    e.preventDefault();
    const t = newTitle.trim();
    if (!t || creating) return;

    setCreating(true);
    try {
      await onCreateSub(t);
      setNewTitle("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <aside className="space-y-3">
      {/* Header */}
      <div className="space-y-1">
        <div className="text-xs text-gray-500">Chương</div>
        <div className="font-semibold text-sm text-gray-900 truncate">
          {chapterTitle}
        </div>
      </div>

      {/* Root selector */}
      <button
        type="button"
        className={`w-full text-left px-2 py-2 rounded-md border text-sm ${
          activeSectionId === "root"
            ? "border-blue-500 bg-blue-50 text-blue-800"
            : "border-transparent hover:bg-gray-50 text-gray-700"
        }`}
        onClick={() => onSelectSection("root")}
      >
        <div className="text-[11px] text-gray-400">Chương chính</div>
        <div className="font-medium truncate">{chapterTitle}</div>
      </button>

      {/* Create */}
      {canManageSubsections && (
        <form className="space-y-2" onSubmit={submitCreate}>
          <input
            className={`${INPUT} text-sm`}
            placeholder="Tiêu đề mục con..."
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            disabled={creating}
          />
          <button
            type="submit"
            className="w-full px-3 py-2 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
            disabled={creating || !newTitle.trim()}
          >
            {creating ? "Đang tạo..." : "+ Thêm mục con"}
          </button>
        </form>
      )}

      {/* List */}
      <div className="space-y-1">
        <div className="text-xs text-gray-500">Mục con</div>

        {loading ? (
          <div className="text-xs text-gray-500">Đang tải...</div>
        ) : sorted.length === 0 ? (
          <div className="text-xs text-gray-500">
            Chưa có mục con nào trong chương này.
          </div>
        ) : (
          <div className="space-y-2">
            {sorted.map((it) => {
              const isActive = activeSectionId === it.id;
              const canEdit = canManageSubsections;

              return (
                <div key={it.id} className="space-y-1">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className={`flex-1 text-left px-2 py-1.5 rounded-md border text-sm ${
                        isActive
                          ? "border-blue-500 bg-blue-50 text-blue-800"
                          : "border-transparent hover:bg-gray-50 text-gray-700"
                      }`}
                      onClick={() => onSelectSection(it.id)}
                    >
                      <div className="text-[11px] text-gray-400">
                        Mục #{it.order_index}
                      </div>
                      <div className="font-medium truncate">{it.title}</div>
                    </button>

                    {canEdit && (
                      <>
                        <button
                          type="button"
                          className="px-1.5 py-1 text-[11px] border rounded-md bg-gray-50 hover:bg-gray-100 text-gray-700"
                          title="Đổi tên mục"
                          onClick={() => {
                            setRenamingId(it.id);
                            setRenamingTitle(it.title);
                          }}
                        >
                          ✎
                        </button>

                        <button
                          type="button"
                          className="px-1.5 py-1 text-[11px] border rounded-md bg-red-50 hover:bg-red-100 text-red-600"
                          title="Xoá mục"
                          onClick={() => onDeleteSub(it.id)}
                        >
                          🗑
                        </button>
                      </>
                    )}
                  </div>

                  {/* Rename inline */}
                  {renamingId === it.id && (
                    <form
                      className="flex items-center gap-2 text-xs"
                      onSubmit={(e) => submitRename(e, it.id)}
                    >
                      <input
                        className={`${INPUT} h-7 text-xs`}
                        value={renamingTitle}
                        onChange={(e) => setRenamingTitle(e.target.value)}
                        disabled={renamingSaving}
                      />
                      <button
                        type="submit"
                        className="px-2 py-1 rounded-md bg-blue-600 text-white text-[11px] hover:bg-blue-700 disabled:opacity-50"
                        disabled={renamingSaving || !renamingTitle.trim()}
                      >
                        Lưu
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 rounded-md border text-[11px] hover:bg-gray-50"
                        onClick={() => {
                          setRenamingId(null);
                          setRenamingTitle("");
                        }}
                      >
                        Hủy
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
