// app/books/[id]/TocRootList.tsx
"use client";

import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";

import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/**
 * ==== TYPES & PROPS ====
 *
 * Bạn cần truyền cho TocRootList từ page.tsx:
 *
 * <TocRootList
 *   bookId={book.id}
 *   versionId={version.id}
 *   role={tocData?.role ?? "viewer"}
 *   items={tocData?.items ?? []}
 *   onReload={async () => { await loadTocTree(version.id); }}
 *   onOpenCreateSection={() => openCreateModal(null, "section")}
 *   onOpenCreateRootChapter={() => openCreateModal(null, "chapter")}
 *   onOpenCreateChild={(pid) => openCreateModal(pid, "chapter")}
 *   onOpenEdit={(item) => openEditModal(item)}
 *   onOpenCompose={(item) =>
 *     router.push(`/books/${book.id}/toc/${item.id}`)
 *   }
 * />
 */

export type BookRole = "viewer" | "author" | "editor";

export type TocItemKind = "section" | "chapter" | "heading" | null;

export type TocKind = "section" | "chapter";

export type TocItem = {
  id: string;
  book_version_id: string;
  parent_id: string | null;
  title: string;
  slug: string;
  order_index: number;
  created_at?: string | null;
  kind: TocItemKind;
};

type TocRootListProps = {
  bookId: string;
  versionId: string;
  role: BookRole;
  items: TocItem[];

  /** Reload lại TOC sau khi reorder / move */
  onReload: () => void | Promise<void>;

  /** Mở modal tạo PHẦN (root, kind="section") */
  onOpenCreateSection: () => void;

  /** Mở modal tạo CHƯƠNG root (chapter lẻ, parent_id = null) */
  onOpenCreateRootChapter: () => void;

  /** Mở modal tạo mục con (chapter con trong section) */
  onOpenCreateChild: (parentId: string) => void;

  /** Mở modal sửa tiêu đề mục lục */
  onOpenEdit: (item: TocItem) => void;

  /** Mở trang biên soạn nội dung chương */
  onOpenCompose: (item: TocItem) => void;
};

/** UI helpers (re-use từ page.tsx cũ) */
const BTN_PRIMARY =
  "inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50";

const ICON_BTN =
  "inline-flex h-7 w-7 items-center justify-center rounded-md border text-sm hover:bg-gray-50 disabled:opacity-50";

const MENU_ITEM = "w-full text-left px-3 py-2 text-sm hover:bg-gray-50";

/** ====== Sortable chapter row (trong 1 section / khối chương lẻ) ====== */
type SortableChapterRowProps = {
  chapter: TocItem;
  chapterNumber: number;
  isEditor: boolean;
  isAuthor: boolean;
  isMenuOpen: boolean;
  onToggleMenu: (id: string) => void;
  onCloseMenu: () => void;
  onOpenEdit: (item: TocItem) => void;
  onOpenCompose: (item: TocItem) => void;
  onMoveUpDown: (id: string, dir: "up" | "down") => void;
  bookId: string;
};

function SortableChapterRow({
  chapter,
  chapterNumber,
  isEditor,
  isAuthor,
  isMenuOpen,
  onToggleMenu,
  onCloseMenu,
  onOpenEdit,
  onOpenCompose,
  onMoveUpDown,
  bookId,
}: SortableChapterRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: chapter.id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative rounded-md border border-gray-200 bg-white px-2 py-2 hover:bg-gray-50"
    >
      <div className="flex items-start justify-between gap-3">
        {/* LEFT */}
        <div className="min-w-0 flex-1 flex gap-2">
          {/* drag handle */}
          {isEditor ? (
            <button
              type="button"
              className="mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border text-gray-600 hover:bg-gray-100"
              title="Kéo để đổi thứ tự chương"
              onClick={(e) => e.stopPropagation()}
              {...attributes}
              {...listeners}
            >
              ⠿
            </button>
          ) : (
            <div className="mt-0.5 h-7 w-7 flex-shrink-0" />
          )}

          <div className="min-w-0 flex-1">
            <button
              type="button"
              className="block w-full truncate text-left text-sm font-semibold text-gray-900 hover:underline"
              onClick={() => {
                if (isAuthor && !isEditor) onOpenCompose(chapter);
                else onOpenEdit(chapter);
              }}
            >
              Chương {chapterNumber}. {chapter.title}
            </button>

            <div className="mt-1 text-xs text-gray-500">
              Thứ tự trong nhóm: {chapter.order_index}
            </div>
          </div>
        </div>

        {/* RIGHT menu */}
        {isEditor && (
          <div className="relative flex-shrink-0">
            <button
              type="button"
              className={ICON_BTN}
              title="Tác vụ chương"
              onClick={(e) => {
                e.stopPropagation();
                onToggleMenu(chapter.id);
              }}
            >
              ⋯
            </button>

            {isMenuOpen && (
              <div
                className="absolute right-0 mt-1 w-52 overflow-hidden rounded-md border bg-white shadow-lg z-20"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className={MENU_ITEM}
                  onClick={() => {
                    onCloseMenu();
                    onOpenEdit(chapter);
                  }}
                >
                  Sửa tiêu đề
                </button>

                <Link
                  href={`/books/${bookId}/toc/${chapter.id}`}
                  className={MENU_ITEM}
                  onClick={() => onCloseMenu()}
                >
                  Mở trang biên soạn →
                </Link>

                <div className="my-1 h-px bg-gray-100" />

                <button
                  type="button"
                  className={MENU_ITEM}
                  onClick={() => {
                    onCloseMenu();
                    onMoveUpDown(chapter.id, "up");
                  }}
                >
                  Đưa lên
                </button>

                <button
                  type="button"
                  className={MENU_ITEM}
                  onClick={() => {
                    onCloseMenu();
                    onMoveUpDown(chapter.id, "down");
                  }}
                >
                  Đưa xuống
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** ====== Modal chọn chương để đưa vào PHẦN ====== */

type MoveChaptersModalProps = {
  open: boolean;
  section: TocItem | null;
  allChapters: TocItem[];
  selectedIds: string[];
  onChangeSelectedIds: (ids: string[]) => void;
  onClose: () => void;
  onConfirm: (ids: string[]) => Promise<void>;
};

function MoveChaptersModal({
  open,
  section,
  allChapters,
  selectedIds,
  onChangeSelectedIds,
  onClose,
  onConfirm,
}: MoveChaptersModalProps) {
  const [saving, setSaving] = useState(false);

  if (!open || !section) return null;

  const toggle = (id: string) => {
    onChangeSelectedIds(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id]
    );
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            Chọn chương để đưa vào PHẦN này
          </h3>
          <button
            className="text-sm text-gray-500 hover:text-gray-800"
            onClick={onClose}
            disabled={saving}
          >
            ✕
          </button>
        </div>

        <p className="mb-3 text-sm text-gray-600">
          PHẦN: <span className="font-semibold">{section.title}</span>
        </p>

        <div className="max-h-80 overflow-auto rounded border p-2 space-y-1">
          {allChapters.length === 0 ? (
            <p className="text-xs text-gray-500">
              Không còn chương nào để chọn.
            </p>
          ) : (
            allChapters.map((ch) => (
              <label
                key={ch.id}
                className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={selectedIds.includes(ch.id)}
                  onChange={() => toggle(ch.id)}
                />
                <span>{ch.title}</span>
              </label>
            ))
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            className="inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium hover:bg-gray-50"
            onClick={onClose}
            disabled={saving}
          >
            Hủy
          </button>
          <button
            className={BTN_PRIMARY}
            disabled={saving || selectedIds.length === 0}
            onClick={async () => {
              if (!selectedIds.length) return;
              setSaving(true);
              try {
                await onConfirm(selectedIds);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Đang chuyển…" : "Chuyển chương đã chọn"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** ====== ChapterList: DnD trong 1 nhóm (section hoặc chương lẻ) ====== */

type ChapterListProps = {
  parentId: string | null;
  versionId: string;
  chapters: TocItem[];
  chapterNumbers: Map<string, number>;
  isEditor: boolean;
  isAuthor: boolean;
  bookId: string;
  onReload: () => void | Promise<void>;
  onOpenEdit: (item: TocItem) => void;
  onOpenCompose: (item: TocItem) => void;
  onMoveUpDown: (id: string, dir: "up" | "down") => void;
};

function ChapterList({
  parentId,
  versionId,
  chapters,
  chapterNumbers,
  isEditor,
  isAuthor,
  bookId,
  onReload,
  onOpenEdit,
  onOpenCompose,
  onMoveUpDown,
}: ChapterListProps) {
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function toggleMenu(id: string) {
    setOpenMenuFor((cur) => (cur === id ? null : id));
  }
  function closeMenu() {
    setOpenMenuFor(null);
  }

  async function handleDragEnd(e: DragEndEvent) {
    if (!isEditor) return;
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const currentOrder = chapters.map((c) => c.id);
    const oldIndex = currentOrder.indexOf(String(active.id));
    const newIndex = currentOrder.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const nextOrder = arrayMove(currentOrder, oldIndex, newIndex);

    try {
      const res = await fetch("/api/toc/items/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_version_id: versionId,
          parent_id: parentId,
          ordered_ids: nextOrder,
        }),
      });

      if (!res.ok) {
        console.error("reorder chapters error", await res.text());
        alert("Không đổi thứ tự chương được.");
        return;
      }
      await onReload();
    } catch (err) {
      console.error("reorder chapters exception", err);
      alert("Không đổi thứ tự chương được.");
    }
  }

  if (chapters.length === 0) return null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={chapters.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="mt-2 space-y-2">
          {chapters.map((ch) => (
            <SortableChapterRow
              key={ch.id}
              chapter={ch}
              chapterNumber={chapterNumbers.get(ch.id) ?? 0}
              isEditor={isEditor}
              isAuthor={isAuthor}
              isMenuOpen={openMenuFor === ch.id}
              onToggleMenu={toggleMenu}
              onCloseMenu={closeMenu}
              onOpenEdit={onOpenEdit}
              onOpenCompose={onOpenCompose}
              onMoveUpDown={onMoveUpDown}
              bookId={bookId}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

/** ====== MAIN COMPONENT ====== */

export default function TocRootList({
  bookId,
  versionId,
  role,
  items,
  onReload,
  onOpenCreateSection,
  onOpenCreateRootChapter,
  onOpenCreateChild,
  onOpenEdit,
  onOpenCompose,
}: TocRootListProps) {
  const isEditor = role === "editor";
  const isAuthor = role === "author";

  /** Map parent_id -> children (đã sort theo order_index) */
  const childrenMap = useMemo(() => {
    const m = new Map<string | null, TocItem[]>();
    for (const it of items) {
      const key = it.parent_id ?? null;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(it);
    }
    for (const [key, list] of m.entries()) {
      list.sort((a, b) => a.order_index - b.order_index);
      m.set(key, list);
    }
    return m;
  }, [items]);

  const rootItems = childrenMap.get(null) || [];

  const rootSections = rootItems.filter((it) => it.kind === "section");
  const rootOrphanChapters = rootItems.filter((it) => it.kind === "chapter");

  const chaptersBySection = useMemo(() => {
    const res = new Map<string, TocItem[]>();
    for (const sec of rootSections) {
      const list =
        (childrenMap.get(sec.id) || []).filter((c) => c.kind === "chapter") ??
        [];
      res.set(
        sec.id,
        [...list].sort((a, b) => a.order_index - b.order_index)
      );
    }
    return res;
  }, [childrenMap, rootSections]);

  /** Đánh số PHẦN và CHƯƠNG */
  const sectionNumberMap = useMemo(() => {
    const m = new Map<string, number>();
    rootSections
      .slice()
      .sort((a, b) => a.order_index - b.order_index)
      .forEach((sec, idx) => {
        m.set(sec.id, idx + 1);
      });
    return m;
  }, [rootSections]);

  const chapterNumberMap = useMemo(() => {
    const m = new Map<string, number>();
    let counter = 1;

    const sortedOrphans = [...rootOrphanChapters].sort(
      (a, b) => a.order_index - b.order_index
    );
    for (const ch of sortedOrphans) {
      m.set(ch.id, counter++);
    }

    const sortedSections = [...rootSections].sort(
      (a, b) => a.order_index - b.order_index
    );
    for (const sec of sortedSections) {
      const list = chaptersBySection.get(sec.id) || [];
      for (const ch of list) {
        m.set(ch.id, counter++);
      }
    }
    return m;
  }, [rootOrphanChapters, rootSections, chaptersBySection]);

  /** MENU state cho PHẦN */
  const [openSectionMenuFor, setOpenSectionMenuFor] = useState<string | null>(
    null
  );
  function toggleSectionMenu(id: string) {
    setOpenSectionMenuFor((cur) => (cur === id ? null : id));
  }
  function closeSectionMenu() {
    setOpenSectionMenuFor(null);
  }

  /** Modal "Đưa chương vào PHẦN" */
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [moveTargetSection, setMoveTargetSection] = useState<TocItem | null>(
    null
  );
  const [moveSelectedChapterIds, setMoveSelectedChapterIds] = useState<
    string[]
  >([]);

  function openMoveChaptersModal(section: TocItem) {
    setMoveTargetSection(section);
    setMoveSelectedChapterIds([]);
    setMoveModalOpen(true);
  }

  function closeMoveChaptersModal() {
    setMoveModalOpen(false);
    setMoveTargetSection(null);
    setMoveSelectedChapterIds([]);
  }

  const availableChaptersForTarget = useMemo(() => {
    if (!moveTargetSection) return [];
    return items.filter(
      (it) =>
        it.kind === "chapter" && it.parent_id !== moveTargetSection.id
    );
  }, [items, moveTargetSection]);

  async function handleConfirmMove(chapterIds: string[]) {
    if (!moveTargetSection || chapterIds.length === 0) return;

    try {
      const res = await fetch("/api/toc/move-to-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section_id: moveTargetSection.id,
          chapter_ids: chapterIds,
        }),
      });

      if (!res.ok) {
        console.error("move-to-section error", await res.text());
        alert("Không chuyển chương vào PHẦN được.");
        return;
      }

      await onReload();
      closeMoveChaptersModal();
    } catch (err) {
      console.error("move-to-section exception", err);
      alert("Không chuyển chương vào PHẦN được.");
    }
  }

  /** Reorder ↑↓ dùng API cũ (cho trường hợp user thích click menu) */
  async function handleMoveItemUpDown(itemId: string, dir: "up" | "down") {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    const parentKey = item.parent_id ?? null;
    const siblings =
      (childrenMap.get(parentKey) || []).filter((s) => s.kind === "chapter") ??
      [];
    const index = siblings.findIndex((s) => s.id === itemId);
    if (index === -1) return;

    const targetIndex = dir === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= siblings.length) return;

    [siblings[index], siblings[targetIndex]] = [
      siblings[targetIndex],
      siblings[index],
    ];

    const orderedIds = siblings.map((s) => s.id);

    try {
      const res = await fetch("/api/toc/items/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_version_id: versionId,
          parent_id: parentKey,
          ordered_ids: orderedIds,
        }),
      });

      if (!res.ok) {
        console.error("reorder(up/down) error", await res.text());
        alert("Không đổi thứ tự chương được.");
        return;
      }
      await onReload();
    } catch (err) {
      console.error("reorder(up/down) exception", err);
      alert("Không đổi thứ tự chương được.");
    }
  }

  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            Mục lục (TOC) của phiên bản này
          </h2>
          <p className="text-xs text-gray-500">
            Vai trò của bạn: {role || "—"}
          </p>
        </div>
        {isEditor && (
          <div className="flex gap-2">
            <button
              className={BTN_PRIMARY}
              type="button"
              onClick={onOpenCreateSection}
            >
              + Tạo PHẦN (Section)
            </button>
            <button
              className={BTN_PRIMARY}
              type="button"
              onClick={onOpenCreateRootChapter}
            >
              + Tạo chương mới
            </button>
          </div>
        )}
      </div>

      {rootSections.length === 0 && rootOrphanChapters.length === 0 && (
        <p className="text-sm text-gray-500">
          Chưa có mục lục nào. Hãy tạo PHẦN hoặc chương mới.
        </p>
      )}

      {/* Chương lẻ không thuộc PHẦN */}
      {rootOrphanChapters.length > 0 && (
        <div className="mb-4 rounded-lg border border-dashed bg-slate-50 p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-gray-700">
              Các chương không thuộc PHẦN
            </div>
          </div>
          <ChapterList
            parentId={null}
            versionId={versionId}
            chapters={[...rootOrphanChapters].sort(
              (a, b) => a.order_index - b.order_index
            )}
            chapterNumbers={chapterNumberMap}
            isEditor={isEditor}
            isAuthor={isAuthor}
            bookId={bookId}
            onReload={onReload}
            onOpenEdit={onOpenEdit}
            onOpenCompose={onOpenCompose}
            onMoveUpDown={handleMoveItemUpDown}
          />
        </div>
      )}

      {/* PHẦN + chương con */}
      <div className="space-y-3">
        {rootSections
          .slice()
          .sort((a, b) => a.order_index - b.order_index)
          .map((sec) => {
            const secNo = sectionNumberMap.get(sec.id) ?? 0;
            const chapters = chaptersBySection.get(sec.id) || [];
            const isMenuOpen = openSectionMenuFor === sec.id;

            return (
              <div
                key={sec.id}
                className="rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white">
                        PHẦN {secNo}
                      </span>
                      <span className="truncate text-sm font-semibold text-gray-900">
                        {sec.title}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-gray-600">
                      Loại: Phần (Section) · Thứ tự: {sec.order_index} ·{" "}
                      {chapters.length} mục con
                    </div>
                  </div>

                  {isEditor && (
                    <div className="relative flex-shrink-0">
                      <button
                        type="button"
                        className={ICON_BTN}
                        title="Tác vụ PHẦN"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSectionMenu(sec.id);
                        }}
                      >
                        ⋯
                      </button>

                      {isMenuOpen && (
                        <div
                          className="absolute right-0 mt-1 w-60 overflow-hidden rounded-md border bg-white shadow-lg z-20"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className={MENU_ITEM}
                            onClick={() => {
                              closeSectionMenu();
                              onOpenEdit(sec);
                            }}
                          >
                            Sửa tên PHẦN
                          </button>

                          <button
                            type="button"
                            className={MENU_ITEM}
                            onClick={() => {
                              closeSectionMenu();
                              onOpenCreateChild(sec.id);
                            }}
                          >
                            Thêm chương trong PHẦN này
                          </button>

                          <button
                            type="button"
                            className={MENU_ITEM}
                            onClick={() => {
                              closeSectionMenu();
                              openMoveChaptersModal(sec);
                            }}
                          >
                            Chọn các chương để đưa vào PHẦN này…
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Danh sách chương con */}
                <ChapterList
                  parentId={sec.id}
                  versionId={versionId}
                  chapters={chapters}
                  chapterNumbers={chapterNumberMap}
                  isEditor={isEditor}
                  isAuthor={isAuthor}
                  bookId={bookId}
                  onReload={onReload}
                  onOpenEdit={onOpenEdit}
                  onOpenCompose={onOpenCompose}
                  onMoveUpDown={handleMoveItemUpDown}
                />
              </div>
            );
          })}
      </div>

      {/* Modal chọn chương đưa vào PHẦN */}
      <MoveChaptersModal
        open={moveModalOpen}
        section={moveTargetSection}
        allChapters={availableChaptersForTarget}
        selectedIds={moveSelectedChapterIds}
        onChangeSelectedIds={setMoveSelectedChapterIds}
        onClose={closeMoveChaptersModal}
        onConfirm={handleConfirmMove}
      />
    </div>
  );
}
