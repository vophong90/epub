// app/books/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

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

/** UI helpers */
const BTN =
  "inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50";
const BTN_PRIMARY =
  "inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50";
const BTN_DANGER =
  "inline-flex items-center justify-center rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50";

// Compact menu helpers
const ICON_BTN =
  "inline-flex h-7 w-7 items-center justify-center rounded-md border text-sm hover:bg-gray-50 disabled:opacity-50";
const MENU_ITEM = "w-full text-left px-3 py-2 text-sm hover:bg-gray-50";

const SELECT =
  "w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400";

/** DB types (tối giản cho UI này) */
type Book = {
  id: string;
  title: string;
  unit_name: string | null;
  created_at: string | null;
};

type BookVersion = {
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

type VersionsApiResponse = {
  ok: boolean;
  is_admin: boolean;
  versions: BookVersion[];
  error?: string;
};

type BookTemplate = {
  id: string;
  name: string;
  description: string | null;
  page_size: string;
  page_margin_mm: any;
  is_active: boolean;
  created_by: string;
  created_at: string;
};

type BookTemplatesResponse = {
  ok: boolean;
  templates: BookTemplate[];
  error?: string;
};

type TocItem = {
  id: string;
  book_version_id: string;
  parent_id: string | null;
  title: string;
  slug: string;
  order_index: number;
  created_at?: string | null;
};

type BookRole = "viewer" | "author" | "editor";

type TocTreeResponse = {
  version_id: string;
  book_id: string;
  role: BookRole;
  items: TocItem[];
};

type MemberProfile = {
  id: string;
  name: string | null;
  email: string | null;
};

type Member = {
  user_id: string;
  role: BookRole;
  profile: MemberProfile | null;
};

type MembersResponse = {
  ok: boolean;
  book_id: string;
  members: Member[];
};

type TocItemDetailResponse = {
  item: TocItem;
  book_id: string;
  role: BookRole;
  content: any | null;
  assignments: { user_id: string; role_in_item: "author" | "editor" }[];
};

function formatDateTime(dt: string | null | undefined) {
  if (!dt) return "";
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return dt;
  return d.toLocaleString("vi-VN");
}

/** Xây map parent_id -> list children, sort theo order_index */
function buildChildrenMap(items: TocItem[]) {
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
}

/** Row kéo-thả cho chương cấp 1 (root) */
function SortableChapterRow(props: {
  it: TocItem;
  idx: number;
  childCount: number;
  isEditor: boolean;
  isMenuOpen: boolean;
  onToggleMenu: (id: string) => void;
  onCloseMenu: () => void;
  onOpenEdit: (it: TocItem) => void;
  onOpenCreateChild: (parentId: string) => void;
  onMoveUpDown: (id: string, dir: "up" | "down") => void;
  bookId: string;
}) {
  const {
    it,
    idx,
    childCount,
    isEditor,
    isMenuOpen,
    onToggleMenu,
    onCloseMenu,
    onOpenEdit,
    onOpenCreateChild,
    onMoveUpDown,
    bookId,
  } = props;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: it.id });

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
              className="block w-full truncate text-left text-sm font-semibold text-gray-900 hover:underline"
              onClick={() => onOpenEdit(it)}
            >
              {idx + 1}. {it.title}
            </button>

            <div className="mt-1 text-xs text-gray-500">
              Thứ tự: {it.order_index}
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
                className="absolute right-0 mt-1 w-52 overflow-hidden rounded-md border bg-white shadow-lg z-20"
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
                    onOpenCreateChild(it.id);
                  }}
                >
                  Thêm mục con
                </button>

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

export default function BookDetailPage() {
  const params = useParams();
  const bookId =
    typeof params?.id === "string"
      ? params.id
      : Array.isArray(params?.id)
      ? params.id[0]
      : "";

  const [book, setBook] = useState<Book | null>(null);
  const [version, setVersion] = useState<BookVersion | null>(null);
  const [tocData, setTocData] = useState<TocTreeResponse | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [creatingVersion, setCreatingVersion] = useState(false);

  /** Templates */
  const [templates, setTemplates] = useState<BookTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  /** Template selection UI */
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(""); // "" nghĩa là chưa chọn/None
  const [savingTemplate, setSavingTemplate] = useState(false);

  /** Modal state cho tạo / sửa TOC */
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [modalParentId, setModalParentId] = useState<string | null>(null);
  const [modalItem, setModalItem] = useState<TocItem | null>(null);
  const [modalTitle, setModalTitle] = useState("");
  const [modalSaving, setModalSaving] = useState(false);
  const [modalDeleting, setModalDeleting] = useState(false);

  const [modalSelectedAuthors, setModalSelectedAuthors] = useState<string[]>([]);
  const [modalOriginalAuthors, setModalOriginalAuthors] = useState<string[]>([]);
  const [modalLoadingAssignments, setModalLoadingAssignments] = useState(false);

  /** Search user để phân công (theo email) */
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [userSearchResults, setUserSearchResults] = useState<MemberProfile[]>(
    []
  );
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [userSearchError, setUserSearchError] = useState<string | null>(null);

  /** MENU state cho card chương (⋯) */
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  const [rootReordering, setRootReordering] = useState(false);

  function toggleMenu(id: string) {
    setOpenMenuFor((cur) => (cur === id ? null : id));
  }
  function closeMenu() {
    setOpenMenuFor(null);
  }

  // Đóng menu khi click ra ngoài / nhấn ESC
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }
    function onClick() {
      closeMenu();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("click", onClick);
    };
  }, []);

  /** Set id set để lọc kết quả search không trùng với members */
  const memberIdSet = useMemo(
    () => new Set(members.map((m) => m.user_id)),
    [members]
  );

  /** Load book + version + toc + members */
  useEffect(() => {
    if (!bookId) return;

    let cancelled = false;

    async function loadAll() {
      setLoading(true);
      setErrorMsg(null);
      try {
        // 1) Load book
        const { data: bookRow, error: bookErr } = await supabase
          .from("books")
          .select("id,title,unit_name,created_at")
          .eq("id", bookId)
          .maybeSingle();

        if (bookErr || !bookRow) {
          if (!cancelled) {
            setErrorMsg("Không tìm thấy sách.");
            setLoading(false);
          }
          return;
        }
        if (cancelled) return;
        setBook(bookRow as Book);

        // 2) Load danh sách version qua API
        const res = await fetch(`/api/books/versions?book_id=${bookId}`);
        const json = (await res
          .json()
          .catch(() => ({}))) as Partial<VersionsApiResponse>;

        if (cancelled) return;

        if (!res.ok || !json.ok) {
          console.error("load versions error:", json.error || res.status);
          setVersion(null);
          return;
        }

        const versions = json.versions || [];
        if (versions.length > 0) {
          const latest = versions[versions.length - 1];
          setVersion(latest);

          // sync selected template from latest
          setSelectedTemplateId(latest.template_id || "");

          // 3) Load TOC tree
          await loadTocTree(latest.id, cancelled);

          // 4) Load members
          await loadMembers(latest.id, cancelled);
        } else {
          setVersion(null);
          setSelectedTemplateId("");
        }
      } catch (e: any) {
        if (!cancelled) setErrorMsg(e?.message || "Lỗi khi tải dữ liệu.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAll();

    return () => {
      cancelled = true;
    };
  }, [bookId]);

  async function loadTocTree(versionId: string, cancelledFlag?: boolean) {
    try {
      const res = await fetch(`/api/toc/tree?version_id=${versionId}`);
      if (!res.ok) {
        console.error("toc/tree error", await res.text());
        return;
      }
      const json = (await res.json()) as TocTreeResponse;
      if (!cancelledFlag) setTocData(json);
    } catch (e) {
      console.error("loadTocTree error", e);
    }
  }

  async function loadMembers(versionId: string, cancelledFlag?: boolean) {
    try {
      const res = await fetch(`/api/toc/members?version_id=${versionId}`);
      if (!res.ok) {
        console.error("toc/members error", await res.text());
        return;
      }
      const json = (await res.json()) as MembersResponse;
      if (!cancelledFlag && json.ok) {
        setMembers(json.members || []);
      }
    } catch (e) {
      console.error("loadMembers error", e);
    }
  }

  async function loadTemplates() {
    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      const res = await fetch("/api/book-templates?active=1");
      const json = (await res
        .json()
        .catch(() => ({}))) as Partial<BookTemplatesResponse>;
      if (!res.ok || !json.ok) {
        console.error(
          "load templates error:",
          (json as any)?.error || res.status
        );
        setTemplates([]);
        setTemplatesError((json as any)?.error || "Không tải được templates.");
        return;
      }
      setTemplates((json.templates || []) as BookTemplate[]);
    } catch (e: any) {
      console.error("loadTemplates error:", e);
      setTemplates([]);
      setTemplatesError(e?.message || "Không tải được templates.");
    } finally {
      setTemplatesLoading(false);
    }
  }

  // Load templates khi đã có version (vì mới cần chọn template)
  useEffect(() => {
    if (!version?.id) return;
    loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version?.id]);

  const isEditor = tocData?.role === "editor";

  /** Children map cho hiển thị + reorder */
  const childrenMap = useMemo(
    () => buildChildrenMap(tocData?.items || []),
    [tocData]
  );

  const rootItems = useMemo(() => childrenMap.get(null) || [], [childrenMap]);

  /**
   * DND: lưu thứ tự hiển thị (list id) cho rootItems
   * - Sync từ server (order_index) mỗi khi rootItems đổi
   * - Dùng để optimistic reorder UI khi kéo-thả
   */
  const [rootOrder, setRootOrder] = useState<string[]>([]);
  useEffect(() => {
    setRootOrder(rootItems.map((x) => x.id));
  }, [rootItems]);

  const rootItemsOrdered = useMemo(() => {
    const map = new Map(rootItems.map((x) => [x.id, x]));
    const ordered = rootOrder
      .map((id) => map.get(id))
      .filter(Boolean) as TocItem[];

    // nếu có item mới mà rootOrder chưa kịp sync
    const missing = rootItems.filter((x) => !rootOrder.includes(x.id));
    return [...ordered, ...missing];
  }, [rootItems, rootOrder]);

  /** DND sensors */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

    async function handleRootDragEnd(e: DragEndEvent) {
    if (!version?.id || rootReordering) return;

    const { active, over } = e;
    if (!over) return;
    if (active.id === over.id) return;

    const prev = rootOrder;
    const oldIndex = prev.indexOf(String(active.id));
    const newIndex = prev.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(prev, oldIndex, newIndex);
    setRootOrder(next); // optimistic UI

    setRootReordering(true);
    try {
      const res = await fetch("/api/toc/items/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_version_id: version.id,
          parent_id: null,
          ordered_ids: next,
        }),
      });

      if (!res.ok) {
        console.error("reorder(root) error", await res.text());
        alert("Không đổi thứ tự được.");
        setRootOrder(prev); // rollback UI
      }
    } catch (err) {
      console.error("reorder(root) exception", err);
      alert("Không đổi thứ tự được.");
      setRootOrder(prev); // rollback nếu exception
    } finally {
      setRootReordering(false);
    }
  }

  /** Tạo phiên bản đầu tiên (đi qua API /api/books/versions) */
  async function handleCreateFirstVersion() {
    if (!bookId) return;
    setCreatingVersion(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/books/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: bookId,
          // template_id: null, // có thể truyền sau nếu muốn chọn template ngay lúc tạo
        }),
      });

      const json = await res.json().catch(() => ({} as any));

      if (!res.ok || !json?.ok || !json?.version) {
        console.error("create version error:", json);
        setErrorMsg(json?.error || "Không tạo được phiên bản mới.");
        return;
      }

      const v = json.version as BookVersion;
      setVersion(v);
      setSelectedTemplateId(v.template_id || "");

      // reload TOC & members cho version mới
      await loadTocTree(v.id);
      await loadMembers(v.id);

      // load templates list
      await loadTemplates();
    } catch (e: any) {
      console.error("handleCreateFirstVersion error:", e);
      setErrorMsg(e?.message || "Lỗi khi tạo phiên bản mới.");
    } finally {
      setCreatingVersion(false);
    }
  }

  /** Lưu template cho version hiện tại (PATCH /api/books/versions) */
  async function handleSaveTemplateForVersion() {
    if (!version?.id) return;
    setSavingTemplate(true);
    try {
      const res = await fetch("/api/books/versions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: version.id,
          template_id: selectedTemplateId ? selectedTemplateId : null,
        }),
      });

      const json = await res.json().catch(() => ({} as any));
      if (!res.ok || !json?.ok || !json?.version) {
        console.error("save template error:", json);
        alert(json?.error || "Không lưu được template cho phiên bản.");
        return;
      }

      const updated = json.version as BookVersion;
      setVersion(updated);
      setSelectedTemplateId(updated.template_id || "");
    } catch (e: any) {
      console.error("handleSaveTemplateForVersion error:", e);
      alert(e?.message || "Không lưu được template.");
    } finally {
      setSavingTemplate(false);
    }
  }

  /** Modal helpers */
  function openCreateModal(parentId: string | null = null) {
    setModalMode("create");
    setModalParentId(parentId);
    setModalItem(null);
    setModalTitle("");
    setModalSelectedAuthors([]);
    setModalOriginalAuthors([]);
    setUserSearchQuery("");
    setUserSearchResults([]);
    setUserSearchError(null);
    setModalOpen(true);
  }

  async function openEditModal(item: TocItem) {
    setModalMode("edit");
    setModalParentId(item.parent_id);
    setModalItem(item);
    setModalTitle(item.title);
    setModalSelectedAuthors([]);
    setModalOriginalAuthors([]);
    setUserSearchQuery("");
    setUserSearchResults([]);
    setUserSearchError(null);
    setModalOpen(true);
    setModalLoadingAssignments(true);

    try {
      const res = await fetch(`/api/toc/item?toc_item_id=${item.id}`);
      if (!res.ok) {
        console.error("load toc item error", await res.text());
        return;
      }
      const json = (await res.json()) as TocItemDetailResponse;
      const authorIds = json.assignments?.map((a) => a.user_id) ?? [];
      setModalSelectedAuthors(authorIds);
      setModalOriginalAuthors(authorIds);
    } catch (e) {
      console.error("openEditModal error", e);
    } finally {
      setModalLoadingAssignments(false);
    }
  }

  function closeModal() {
    if (modalSaving || modalDeleting) return;
    setModalOpen(false);
  }

  /** Search user theo email (client-side qua Supabase) */
  async function handleSearchUsers() {
    const q = userSearchQuery.trim();
    if (!q) {
      setUserSearchResults([]);
      setUserSearchError(null);
      return;
    }
    setUserSearchLoading(true);
    setUserSearchError(null);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,name,email")
        .ilike("email", `%${q}%`)
        .limit(10);

      if (error) {
        console.error("search users error:", error);
        setUserSearchError("Không tìm được user phù hợp hoặc lỗi khi tìm kiếm.");
        setUserSearchResults([]);
        return;
      }

      setUserSearchResults((data || []) as MemberProfile[]);
      if (!data || data.length === 0) {
        setUserSearchError("Không tìm thấy user nào với email này.");
      }
    } catch (e) {
      console.error("search users exception:", e);
      setUserSearchError("Lỗi khi tìm user.");
      setUserSearchResults([]);
    } finally {
      setUserSearchLoading(false);
    }
  }

  /** Lưu TOC (create / edit) + đồng bộ assignments */
  async function handleSaveToc() {
    if (!version) return;
    if (!modalTitle.trim()) {
      alert("Tiêu đề không được để trống.");
      return;
    }
    setModalSaving(true);
    try {
      let currentItemId = modalItem?.id || "";

      if (modalMode === "create") {
        const res = await fetch("/api/toc/item", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            book_version_id: version.id,
            parent_id: modalParentId,
            title: modalTitle.trim(),
          }),
        });
        if (!res.ok) {
          console.error("create toc item error", await res.text());
          alert("Không tạo được mục lục mới.");
          return;
        }
        const json = await res.json();
        currentItemId = json.item?.id;
      } else if (modalMode === "edit" && modalItem) {
        const res = await fetch("/api/toc/item", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: modalItem.id,
            title: modalTitle.trim(),
          }),
        });
        if (!res.ok) {
          console.error("update toc item error", await res.text());
          alert("Không cập nhật được mục lục.");
          return;
        }
      }

      // Đồng bộ assignments (author)
      if (currentItemId) {
        const origSet = new Set(modalOriginalAuthors);
        const newSet = new Set(modalSelectedAuthors);

        const toAdd = [...newSet].filter((id) => !origSet.has(id));
        const toRemove = [...origSet].filter((id) => !newSet.has(id));

        for (const uid of toAdd) {
          await fetch("/api/toc/assignments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              toc_item_id: currentItemId,
              user_id: uid,
              role_in_item: "author",
            }),
          });
        }

        for (const uid of toRemove) {
          await fetch(
            `/api/toc/assignments?toc_item_id=${currentItemId}&user_id=${uid}`,
            { method: "DELETE" }
          );
        }
      }

      // Reload TOC + members
      await loadTocTree(version.id);
      await loadMembers(version.id);

      closeModal();
    } finally {
      setModalSaving(false);
    }
  }

  /** Xoá TOC (cả cây con) */
  async function handleDeleteToc() {
    if (!version || !modalItem) return;
    if (
      !confirm(
        "Bạn chắc chắn muốn xóa mục này (bao gồm các mục con và nội dung liên quan)?"
      )
    ) {
      return;
    }
    setModalDeleting(true);
    try {
      const res = await fetch(`/api/toc/items?id=${modalItem.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        console.error("delete toc item error", await res.text());
        alert("Không xóa được mục lục.");
        return;
      }
      await loadTocTree(version.id);
      closeModal();
    } finally {
      setModalDeleting(false);
    }
  }

  /** Reorder ↑ / ↓ */
  async function handleMoveItem(itemId: string, direction: "up" | "down") {
    if (!version || !tocData) return;
    const items = tocData.items;
    const item = items.find((i) => i.id === itemId);
    if (!item) return;

    const parentKey = item.parent_id ?? null;
    const siblings = [...(childrenMap.get(parentKey) || [])];
    const index = siblings.findIndex((s) => s.id === itemId);
    if (index === -1) return;

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= siblings.length) return;

    [siblings[index], siblings[targetIndex]] = [
      siblings[targetIndex],
      siblings[index],
    ];

    const orderedIds = siblings.map((s) => s.id);

    const res = await fetch("/api/toc/items/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        book_version_id: version.id,
        parent_id: item.parent_id,
        ordered_ids: orderedIds,
      }),
    });
    if (!res.ok) {
      console.error("reorder error", await res.text());
      alert("Không đổi thứ tự được.");
      return;
    }
    await loadTocTree(version.id);
  }

  if (!bookId) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6">
        <p>Thiếu ID sách.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6">
        <p>Đang tải dữ liệu…</p>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <p className="text-red-600">{errorMsg}</p>
        <Link href="/books" className={BTN}>
          ← Quay lại danh sách
        </Link>
      </div>
    );
  }

  if (!book) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <p>Không tìm thấy sách.</p>
        <Link href="/books" className={BTN}>
          ← Quay lại danh sách
        </Link>
      </div>
    );
  }

  const currentTemplate =
    version?.template_id && templates.length
      ? templates.find((t) => t.id === version.template_id) || null
      : null;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
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
          <p className="text-sm text-gray-500">
            Đơn vị: {book.unit_name || "—"}
          </p>
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
        </div>
      </div>

      {/* Nếu chưa có version */}
      {!version && (
        <div className="space-y-4">
          <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-800">
              Sách này chưa có phiên bản nào. Bạn cần tạo phiên bản đầu tiên
              trước khi xây dựng mục lục.
            </p>
            <button
              className={BTN_PRIMARY}
              onClick={handleCreateFirstVersion}
              disabled={creatingVersion}
            >
              {creatingVersion ? "Đang tạo phiên bản…" : "Tạo phiên bản đầu tiên"}
            </button>
          </div>
        </div>
      )}

      {/* Khi đã có version */}
      {version && (
        <div className="space-y-4">
          {/* Template selector */}
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
                        templates.find((x) => x.id === selectedTemplateId)?.name ||
                        "—"
                      }`
                    : "Chưa chọn template"}
                </div>
              </div>

              {/* Middle: select */}
              <div className="w-full md:w-[520px]">
                <select
                  className={SELECT}
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
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
                  <div className="mt-1 text-[11px] text-red-600">
                    {templatesError}
                  </div>
                ) : null}
              </div>

              {/* Right: save */}
              <div className="shrink-0">
                <button
                  className={BTN_PRIMARY}
                  onClick={handleSaveTemplateForVersion}
                  disabled={savingTemplate || templatesLoading}
                  title="Lưu template"
                >
                  {savingTemplate ? "Đang lưu…" : "Lưu template"}
                </button>
              </div>
            </div>
          </div>

          {/* TOC */}
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">
                  Mục lục (TOC) của phiên bản này
                </h2>
                <p className="text-xs text-gray-500">
                  Vai trò của bạn: {tocData?.role || "—"}
                </p>
              </div>
              {isEditor && (
                <button
                  className={BTN_PRIMARY}
                  onClick={() => openCreateModal(null)}
                >
                  + Tạo chương mới
                </button>
              )}
            </div>

            {rootItems.length === 0 && (
              <p className="text-sm text-gray-500">
                Chưa có chương nào. Nhấn “Tạo chương mới” để bắt đầu.
              </p>
            )}

            {/* ✅ Drag & Drop reorder cho rootItems (không lược bỏ menu ⋯ + nút đưa lên/xuống) */}
            <div className="space-y-2">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleRootDragEnd}
              >
                <SortableContext
                  items={rootItemsOrdered.map((x) => x.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {rootItemsOrdered.map((it, idx) => {
                    const childCount = childrenMap.get(it.id)?.length || 0;
                    const isMenuOpen = openMenuFor === it.id;

                    return (
                      <SortableChapterRow
                        key={it.id}
                        it={it}
                        idx={idx}
                        childCount={childCount}
                        isEditor={isEditor}
                        isMenuOpen={isMenuOpen}
                        onToggleMenu={toggleMenu}
                        onCloseMenu={closeMenu}
                        onOpenEdit={openEditModal}
                        onOpenCreateChild={(pid) => openCreateModal(pid)}
                        onMoveUpDown={handleMoveItem}
                        bookId={book.id}
                      />
                    );
                  })}
                </SortableContext>
              </DndContext>
            </div>
          </div>
        </div>
      )}

      {/* MODAL tạo / sửa TOC */}
      {modalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
          <div className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">
                {modalMode === "create"
                  ? modalParentId
                    ? "Tạo mục con mới"
                    : "Tạo chương mới (cấp 1)"
                  : "Chỉnh sửa mục lục"}
              </h3>
              <button
                className="text-sm text-gray-500 hover:text-gray-800"
                onClick={closeModal}
                disabled={modalSaving || modalDeleting}
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {modalParentId && (
                <p className="text-xs text-gray-500">
                  Mục cha:{" "}
                  <span className="font-medium">
                    {(tocData?.items || []).find((i) => i.id === modalParentId)
                      ?.title || "(không tìm thấy)"}
                  </span>
                </p>
              )}

              {/* Tiêu đề */}
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Tiêu đề
                </label>
                <input
                  type="text"
                  className="mt-1 w-full rounded border px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                  value={modalTitle}
                  onChange={(e) => setModalTitle(e.target.value)}
                  placeholder="Nhập tiêu đề chương / mục…"
                />
              </div>

              {/* Gán author */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700">
                    Phân công tác giả cho mục này
                  </label>
                  {modalLoadingAssignments && (
                    <span className="text-xs text-gray-500">
                      Đang tải phân công…
                    </span>
                  )}
                </div>

                {/* Tìm user theo email */}
                <div className="mb-2 flex gap-2">
                  <input
                    type="text"
                    className="w-full rounded border px-3 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                    placeholder="Nhập email (hoặc một phần) để tìm user…"
                    value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleSearchUsers();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className={BTN}
                    onClick={handleSearchUsers}
                    disabled={userSearchLoading}
                  >
                    {userSearchLoading ? "Đang tìm…" : "Tìm"}
                  </button>
                </div>
                {userSearchError && (
                  <p className="mb-1 text-xs text-red-600">{userSearchError}</p>
                )}

                {/* Kết quả tìm kiếm (user chưa là member của sách) */}
                {userSearchResults.filter((u) => !memberIdSet.has(u.id)).length >
                  0 && (
                  <div className="mb-2 rounded border border-dashed border-gray-300 p-2 text-xs">
                    <p className="mb-1 font-semibold text-gray-700">
                      Kết quả tìm kiếm (user chưa là thành viên sách):
                    </p>
                    <div className="max-h-32 space-y-1 overflow-auto">
                      {userSearchResults
                        .filter((u) => !memberIdSet.has(u.id))
                        .map((u) => (
                          <label
                            key={u.id}
                            className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-gray-50"
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                className="h-4 w-4"
                                checked={modalSelectedAuthors.includes(u.id)}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setModalSelectedAuthors((prev) => {
                                    if (checked)
                                      return prev.includes(u.id)
                                        ? prev
                                        : [...prev, u.id];
                                    return prev.filter((id) => id !== u.id);
                                  });
                                }}
                              />
                              <span>
                                {u.name || "(Không tên)"}{" "}
                                <span className="text-xs text-gray-500">
                                  ({u.email})
                                </span>
                              </span>
                            </div>
                            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-indigo-700">
                              mới
                            </span>
                          </label>
                        ))}
                    </div>
                    <p className="mt-1 text-[11px] text-gray-500">
                      Khi lưu, các user này sẽ được thêm vào sách với vai trò{" "}
                      <strong>author</strong> và phân công cho mục này.
                    </p>
                  </div>
                )}

                {/* Danh sách member (từ book_permissions) */}
                {members.length === 0 ? (
                  <p className="text-xs text-gray-500">
                    Hiện chưa có thành viên nào ở cấp sách. Bạn có thể tìm user
                    theo email ở trên và tick chọn để phân công.
                  </p>
                ) : (
                  <div className="max-h-48 space-y-1 overflow-auto rounded border p-2">
                    {members.map((m) => (
                      <label
                        key={m.user_id}
                        className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-gray-50"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={modalSelectedAuthors.includes(m.user_id)}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setModalSelectedAuthors((prev) => {
                                if (checked)
                                  return prev.includes(m.user_id)
                                    ? prev
                                    : [...prev, m.user_id];
                                return prev.filter((id) => id !== m.user_id);
                              });
                            }}
                          />
                          <span>
                            {m.profile?.name || "(Không tên)"}{" "}
                            <span className="text-xs text-gray-500">
                              ({m.profile?.email})
                            </span>
                          </span>
                        </div>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                          {m.role}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  Role hiển thị bên phải là vai trò ở cấp sách (viewer/author/editor).
                  Phân công ở đây sẽ tạo quyền <strong>author</strong> cho mục
                  lục này (và tự thêm vào sách nếu chưa có).
                </p>
              </div>

              {/* Link mở trang biên soạn */}
              {modalItem && (
                <div className="rounded bg-gray-50 p-2 text-xs text-gray-600">
                  <span className="mr-1">Trang biên soạn nội dung:</span>
                  <Link
                    href={`/books/${book.id}/toc/${modalItem.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    /books/{book.id}/toc/{modalItem.id}
                  </Link>
                </div>
              )}
            </div>

            {/* Footer buttons */}
            <div className="mt-5 flex items-center justify-between">
              <div className="flex gap-2">
                <button
                  className={BTN}
                  onClick={closeModal}
                  disabled={modalSaving || modalDeleting}
                >
                  Hủy
                </button>
                <button
                  className={BTN_PRIMARY}
                  onClick={handleSaveToc}
                  disabled={modalSaving || modalDeleting}
                >
                  {modalSaving ? "Đang lưu…" : "Lưu"}
                </button>
              </div>
              {modalMode === "edit" && (
                <button
                  className={BTN_DANGER}
                  onClick={handleDeleteToc}
                  disabled={modalSaving || modalDeleting}
                >
                  {modalDeleting ? "Đang xóa…" : "Xóa mục này"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
