// app/books/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

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
  const [userSearchResults, setUserSearchResults] = useState<MemberProfile[]>([]);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [userSearchError, setUserSearchError] = useState<string | null>(null);

  /** MENU state cho card chương (⋯) */
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);

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

        // 2) Load danh sách version qua API (đã kiểm tra quyền, RLS, v.v.)
        const res = await fetch(`/api/books/versions?book_id=${bookId}`);
        const json = (await res.json().catch(() => ({}))) as Partial<VersionsApiResponse>;

        if (cancelled) return;

        if (!res.ok || !json.ok) {
          console.error("load versions error:", json.error || res.status);
          setVersion(null);
          return;
        }

        const versions = json.versions || [];
        if (versions.length > 0) {
          // API đang order version_no ascending, nên lấy phần tử cuối là mới nhất
          const latest = versions[versions.length - 1];
          setVersion(latest);

          // 3) Load TOC tree
          await loadTocTree(latest.id, cancelled);

          // 4) Load members
          await loadMembers(latest.id, cancelled);
        } else {
          setVersion(null);
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

  const isEditor = tocData?.role === "editor";

  /** Children map cho hiển thị + reorder */
  const childrenMap = useMemo(
    () => buildChildrenMap(tocData?.items || []),
    [tocData]
  );

  const rootItems = useMemo(() => childrenMap.get(null) || [], [childrenMap]);

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

      // reload TOC & members cho version mới
      await loadTocTree(v.id);
      await loadMembers(v.id);
    } catch (e: any) {
      console.error("handleCreateFirstVersion error:", e);
      setErrorMsg(e?.message || "Lỗi khi tạo phiên bản mới.");
    } finally {
      setCreatingVersion(false);
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
      // profiles.id = auth.users.id theo schema của bạn
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
        const res = await fetch("/api/toc/items", {
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
        const res = await fetch("/api/toc/items", {
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
          await fetch(`/api/toc/assignments?toc_item_id=${currentItemId}&user_id=${uid}`, {
            method: "DELETE",
          });
        }
      }

      // Reload TOC + members (vì backend có thể auto-add vào book_permissions)
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

    [siblings[index], siblings[targetIndex]] = [siblings[targetIndex], siblings[index]];

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
          <p className="text-sm text-gray-500">Đơn vị: {book.unit_name || "—"}</p>
          {version && (
            <p className="mt-1 text-sm text-gray-500">
              Phiên bản {version.version_no} –{" "}
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                {version.status}
              </span>{" "}
              · Tạo lúc {formatDateTime(version.created_at)}
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
              Sách này chưa có phiên bản nào. Bạn cần tạo phiên bản đầu tiên trước
              khi xây dựng mục lục.
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
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Mục lục (TOC) của phiên bản này</h2>
                <p className="text-xs text-gray-500">Vai trò của bạn: {tocData?.role || "—"}</p>
              </div>
              {isEditor && (
                <button className={BTN_PRIMARY} onClick={() => openCreateModal(null)}>
                  + Tạo chương mới
                </button>
              )}
            </div>

            {rootItems.length === 0 && (
              <p className="text-sm text-gray-500">
                Chưa có chương nào. Nhấn “Tạo chương mới” để bắt đầu.
              </p>
            )}

            <div className="space-y-2">
              {rootItems.map((it, idx) => {
                const childCount = childrenMap.get(it.id)?.length || 0;
                const isMenuOpen = openMenuFor === it.id;

                return (
                  <div
                    key={it.id}
                    className="relative rounded-md border border-gray-200 bg-white px-2 py-2 hover:bg-gray-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          className="block w-full truncate text-left text-sm font-semibold text-gray-900 hover:underline"
                          onClick={() => openEditModal(it)}
                        >
                          {idx + 1}. {it.title}
                        </button>

                        <div className="mt-1 text-xs text-gray-500">
                          Thứ tự: {it.order_index}
                          {childCount > 0 ? ` · ${childCount} mục con` : ""}
                        </div>
                      </div>

                      {isEditor && (
                        <div className="relative flex-shrink-0">
                          <button
                            type="button"
                            className={ICON_BTN}
                            title="Tác vụ"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleMenu(it.id);
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
                                  closeMenu();
                                  openEditModal(it);
                                }}
                              >
                                Sửa tiêu đề
                              </button>

                              <button
                                type="button"
                                className={MENU_ITEM}
                                onClick={() => {
                                  closeMenu();
                                  openCreateModal(it.id);
                                }}
                              >
                                Thêm mục con
                              </button>

                              <Link
                                href={`/books/${book.id}/toc/${it.id}`}
                                className={MENU_ITEM}
                                onClick={() => closeMenu()}
                              >
                                Mở trang biên soạn →
                              </Link>

                              <div className="my-1 h-px bg-gray-100" />

                              <button
                                type="button"
                                className={MENU_ITEM}
                                onClick={() => {
                                  closeMenu();
                                  handleMoveItem(it.id, "up");
                                }}
                              >
                                Đưa lên
                              </button>

                              <button
                                type="button"
                                className={MENU_ITEM}
                                onClick={() => {
                                  closeMenu();
                                  handleMoveItem(it.id, "down");
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
              })}
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
                    {(tocData?.items || []).find((i) => i.id === modalParentId)?.title ||
                      "(không tìm thấy)"}
                  </span>
                </p>
              )}

              {/* Tiêu đề */}
              <div>
                <label className="block text-sm font-medium text-gray-700">Tiêu đề</label>
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
                    <span className="text-xs text-gray-500">Đang tải phân công…</span>
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
                {userSearchResults.filter((u) => !memberIdSet.has(u.id)).length > 0 && (
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
                                    if (checked) return prev.includes(u.id) ? prev : [...prev, u.id];
                                    return prev.filter((id) => id !== u.id);
                                  });
                                }}
                              />
                              <span>
                                {u.name || "(Không tên)"}{" "}
                                <span className="text-xs text-gray-500">({u.email})</span>
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
                    Hiện chưa có thành viên nào ở cấp sách. Bạn có thể tìm user theo email ở trên
                    và tick chọn để phân công.
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
                                if (checked) return prev.includes(m.user_id) ? prev : [...prev, m.user_id];
                                return prev.filter((id) => id !== m.user_id);
                              });
                            }}
                          />
                          <span>
                            {m.profile?.name || "(Không tên)"}{" "}
                            <span className="text-xs text-gray-500">({m.profile?.email})</span>
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
                  Role hiển thị bên phải là vai trò ở cấp sách (viewer/author/editor). Phân công ở
                  đây sẽ tạo quyền <strong>author</strong> cho mục lục này (và tự thêm vào sách nếu
                  chưa có).
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
                <button className={BTN} onClick={closeModal} disabled={modalSaving || modalDeleting}>
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
