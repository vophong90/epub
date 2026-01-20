// app/books/[id]/TocRootList.tsx
"use client";

import { type CSSProperties } from "react";
import Link from "next/link";

/** dnd-kit */
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const ICON_BTN =
  "inline-flex h-7 w-7 items-center justify-center rounded-md border text-sm hover:bg-gray-50 disabled:opacity-50";
const MENU_ITEM = "w-full text-left px-3 py-2 text-sm hover:bg-gray-50";

export type BookRole = "viewer" | "author" | "editor";
export type TocKind = "section" | "chapter" | "heading";

export type TocItem = {
  id: string;
  book_version_id: string;
  parent_id: string | null;
  title: string;
  slug: string;
  order_index: number;
  kind: TocKind;
  created_at?: string | null;
};

type SortableChapterRowProps = {
  it: TocItem;
  idx: number;
  childCount: number;
  isEditor: boolean;
  isAuthor: boolean;
  isMenuOpen: boolean;
  onToggleMenu: (id: string) => void;
  onCloseMenu: () => void;
  onOpenEdit: (it: TocItem) => void;
  onOpenCompose: (it: TocItem) => void;
  onOpenCreateChild: (parent: TocItem) => void;
  onMoveUpDown: (id: string, dir: "up" | "down") => void;
  onOpenAssignToSection: (section: TocItem) => void; // ⭐ mới
  bookId: string;
  sectionNumber?: number | null;
};

function SortableChapterRow({
  it,
  idx,
  childCount,
  isEditor,
  isAuthor,
  isMenuOpen,
  onToggleMenu,
  onCloseMenu,
  onOpenEdit,
  onOpenCompose,
  onOpenCreateChild,
  onMoveUpDown,
  onOpenAssignToSection,
  bookId,
  sectionNumber,
}: SortableChapterRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: it.id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  const isSection = it.kind === "section";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative rounded-md border bg-white px-2 py-2 hover:bg-gray-50 ${
        isSection ? "border-indigo-300 bg-indigo-50/70" : "border-gray-200"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* LEFT */}
        <div className="min-w-0 flex-1 flex gap-2">
          {/* drag handle */}
          {isEditor ? (
            <button
              type="button"
              className="mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border text-gray-600 hover:bg-gray-100"
              title="Kéo để đổi thứ tự"
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
              className={`block w-full truncate text-left text-sm font-semibold ${
                isSection ? "text-indigo-900" : "text-gray-900"
              } hover:underline`}
              onClick={() => {
                if (isAuthor && !isEditor) onOpenCompose(it);
                else onOpenEdit(it);
              }}
            >
              {isSection ? (
                <>
                  PHẦN {sectionNumber ?? "?"}. {it.title}
                </>
              ) : (
                <>
                  {idx + 1}. {it.title}
                </>
              )}
            </button>

            <div className="mt-1 text-xs text-gray-500">
              Loại:{" "}
              {isSection
                ? "Phần (Section)"
                : it.kind === "chapter"
                ? "Chương"
                : "Mục con"}
              {" · "}Thứ tự: {it.order_index}
              {childCount > 0 ? ` · ${childCount} mục con` : ""}
            </div>
          </div>
        </div>

        {/* RIGHT menu */}
        {isEditor && (
          <div className="relative flex-shrink-0">
            <button
              type="button"
              className={ICON_BTN}
              title="Tác vụ"
              onClick={(e) => {
                e.stopPropagation();
                onToggleMenu(it.id);
              }}
            >
              ⋯
            </button>

            {isMenuOpen && (
              <div
                className="absolute right-0 mt-1 w-56 overflow-hidden rounded-md border bg-white shadow-lg z-20"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className={MENU_ITEM}
                  onClick={() => {
                    onCloseMenu();
                    onOpenEdit(it);
                  }}
                >
                  Sửa tiêu đề
                </button>

                <button
                  type="button"
                  className={MENU_ITEM}
                  onClick={() => {
                    onCloseMenu();
                    onOpenCreateChild(it);
                  }}
                >
                  {it.kind === "section"
                    ? "Thêm chương trong PHẦN này"
                    : "Thêm mục con"}
                </button>

                {isSection && (
                  <button
                    type="button"
                    className={MENU_ITEM}
                    onClick={() => {
                      onCloseMenu();
                      onOpenAssignToSection(it);
                    }}
                  >
                    Chọn chương có sẵn đưa vào PHẦN này
                  </button>
                )}

                <Link
                  href={`/books/${bookId}/toc/${it.id}`}
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
                    onMoveUpDown(it.id, "up");
                  }}
                >
                  Đưa lên
                </button>

                <button
                  type="button"
                  className={MENU_ITEM}
                  onClick={() => {
                    onCloseMenu();
                    onMoveUpDown(it.id, "down");
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

export type TocRootListProps = {
  bookId: string;
  isEditor: boolean;
  isAuthor: boolean;
  rootItemsOrdered: TocItem[];
  childrenMap: Map<string | null, TocItem[]>;
  openMenuFor: string | null;
  onToggleMenu: (id: string) => void;
  onCloseMenu: () => void;
  onOpenEdit: (it: TocItem) => void;
  onOpenCreateChild: (parent: TocItem) => void;
  onMoveUpDown: (id: string, dir: "up" | "down") => void;
  onOpenAssignToSection: (section: TocItem) => void; // ⭐ mới
  rootOrder: string[];
  onRootReorder: (next: string[], prev: string[]) => void;
};

export function TocRootList({
  bookId,
  isEditor,
  isAuthor,
  rootItemsOrdered,
  childrenMap,
  openMenuFor,
  onToggleMenu,
  onCloseMenu,
  onOpenEdit,
  onOpenCreateChild,
  onMoveUpDown,
  onOpenAssignToSection,
  rootOrder,
  onRootReorder,
}: TocRootListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  async function handleRootDragEnd(e: DragEndEvent) {
    if (!isEditor) return;
    const { active, over } = e;
    if (!over) return;
    if (active.id === over.id) return;

    const prev = rootOrder;
    const oldIndex = prev.indexOf(String(active.id));
    const newIndex = prev.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(prev, oldIndex, newIndex);
    onRootReorder(next, prev);
  }

  if (!rootItemsOrdered.length) {
    return (
      <p className="text-sm text-gray-500">
        Chưa có chương hay PHẦN nào. Nhấn “Tạo PHẦN” hoặc “Tạo chương mới” để
        bắt đầu.
      </p>
    );
  }

  // Đánh số PHẦN dựa trên thứ tự các root có kind = 'section'
  const sectionOrderMap = new Map<string, number>();
  {
    let counter = 0;
    for (const it of rootItemsOrdered) {
      if (it.kind === "section") {
        counter += 1;
        sectionOrderMap.set(it.id, counter);
      }
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleRootDragEnd}
    >
      <SortableContext
        items={rootItemsOrdered.map((x) => x.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-2">
          {rootItemsOrdered.map((it, idx) => {
            const childCount = childrenMap.get(it.id)?.length || 0;
            const isMenuOpen = openMenuFor === it.id;
            const sectionNumber = sectionOrderMap.get(it.id) ?? null;

            return (
              <SortableChapterRow
                key={it.id}
                it={it}
                idx={idx}
                childCount={childCount}
                isEditor={isEditor}
                isAuthor={isAuthor}
                isMenuOpen={isMenuOpen}
                onToggleMenu={onToggleMenu}
                onCloseMenu={onCloseMenu}
                onOpenEdit={onOpenEdit}
                onOpenCompose={(toc) =>
                  (window.location.href = `/books/${bookId}/toc/${toc.id}`)
                }
                onOpenCreateChild={onOpenCreateChild}
                onMoveUpDown={onMoveUpDown}
                onOpenAssignToSection={onOpenAssignToSection}
                bookId={bookId}
                sectionNumber={sectionNumber}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
