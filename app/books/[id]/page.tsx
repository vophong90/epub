// app/books/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

import {
  BookHeaderSection,
  type Book,
  type BookVersion,
  type BookTemplate,
} from "./BookHeaderSection";

import TocRootList, {
  type TocItem as TocItemRoot,
  type BookRole,
  type TocKind,
} from "./TocRootList";

import {
  TocModal,
  type TocItem as TocItemModal,
  type Member as ModalMember,
  type MemberProfile as ModalMemberProfile,
} from "./TocModal";

/** UI helpers riêng cho trang */
const BTN =
  "inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50";
const BTN_PRIMARY =
  "inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50";

/** API response types */
type VersionsApiResponse = {
  ok: boolean;
  is_admin: boolean;
  book_role: string; // viewer|author|editor... (từ book_permissions), admin lấy từ profiles.system_role
  versions: BookVersion[];
  error?: string;
};

type TocTreeResponse = {
  version_id: string;
  book_id: string;
  role: BookRole;
  items: TocItemRoot[];
};

type MemberProfile = ModalMemberProfile;
type Member = ModalMember;

type MembersResponse = {
  ok: boolean;
  book_id: string;
  members: Member[];
};

type TocItemDetailResponse = {
  item: TocItemRoot;
  book_id: string;
  role: BookRole;
  content: any | null;
  assignments: { user_id: string; role_in_item: "author" | "editor" }[];
};

/** Xây map parent_id -> list children, sort theo order_index */
function buildChildrenMap(items: TocItemRoot[]) {
  const m = new Map<string | null, TocItemRoot[]>();
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

/** Modal chọn nhiều chương để đưa vào PHẦN */
type AssignChaptersModalProps = {
  open: boolean;
  sectionTitle: string;
  availableChapters: TocItemRoot[];
  selectedChapterIds: string[];
  assigning: boolean;
  onChangeSelected: (ids: string[]) => void;
  onClose: () => void;
  onConfirm: () => void;
};

function AssignChaptersModal({
  open,
  sectionTitle,
  availableChapters,
  selectedChapterIds,
  assigning,
  onChangeSelected,
  onClose,
  onConfirm,
}: AssignChaptersModalProps) {
  if (!open) return null;

  function toggleChapter(id: string, checked: boolean) {
    if (checked) {
      if (!selectedChapterIds.includes(id)) {
        onChangeSelected([...selectedChapterIds, id]);
      }
    } else {
      onChangeSelected(selectedChapterIds.filter((x) => x !== id));
    }
  }

  const noneAvailable = availableChapters.length === 0;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
      <div
        className="w-full max-w-xl rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            Chọn chương đưa vào phần: {sectionTitle}
          </h3>
          <button
            className="text-sm text-gray-500 hover:text-gray-800"
            onClick={onClose}
            disabled={assigning}
          >
            ✕
          </button>
        </div>

        {noneAvailable ? (
          <p className="text-sm text-gray-600">
            Hiện không có chương root nào (Chương cấp 1, không thuộc phần) để đưa
            vào phần này.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Chọn các chương cấp 1 (đang là chương lẻ) để chuyển vào phần này.
              Khi xác nhận, các chương sẽ được đặt ở cuối danh sách trong phần.
            </p>

            <div className="max-h-64 space-y-1 overflow-auto rounded border p-2">
              {availableChapters.map((ch, idx) => (
                <label
                  key={ch.id}
                  className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-gray-50"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={selectedChapterIds.includes(ch.id)}
                      onChange={(e) => toggleChapter(ch.id, e.target.checked)}
                    />
                    <span>
                      {idx + 1}. {ch.title}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">
                    Thứ tự hiện tại: {ch.order_index}
                  </span>
                </label>
              ))}
            </div>

            <p className="text-xs text-gray-500">
              Thứ tự sau khi chuyển sẽ được sắp ở cuối phần, theo thứ tự bạn tick
              ở đây.
            </p>
          </div>
        )}

        <div className="mt-5 flex items-center justify-between">
          <button className={BTN} onClick={onClose} disabled={assigning}>
            Hủy
          </button>
          <button
            className={BTN_PRIMARY}
            onClick={onConfirm}
            disabled={assigning || selectedChapterIds.length === 0}
          >
            {assigning ? "Đang chuyển..." : "Chuyển chương vào phần"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BookDetailPage() {
  const params = useParams();
  const router = useRouter();

  const bookId =
    typeof params?.id === "string"
      ? params.id
      : Array.isArray(params?.id)
      ? params.id[0]
      : "";

  const [book, setBook] = useState<Book | null>(null);

  // ✅ Versions dropdown
  const [versions, setVersions] = useState<BookVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string>("");

  const [version, setVersion] = useState<BookVersion | null>(null);
  const [tocData, setTocData] = useState<TocTreeResponse | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [creatingVersion, setCreatingVersion] = useState(false);
  const [hasPublishedVersion, setHasPublishedVersion] = useState(false);

  // ✅ Permission for delete-version
  const [isAdmin, setIsAdmin] = useState(false);
  const [bookRole, setBookRole] = useState<string>("viewer");
  const [deletingVersion, setDeletingVersion] = useState(false);

  /** Templates */
  const [templates, setTemplates] = useState<BookTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  /** Template selection UI */
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  /** Modal state cho tạo / sửa TOC */
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [modalParentId, setModalParentId] = useState<string | null>(null);
  const [modalItem, setModalItem] = useState<TocItemModal | null>(null);
  const [modalTitle, setModalTitle] = useState("");
  const [modalSaving, setModalSaving] = useState(false);
  const [modalDeleting, setModalDeleting] = useState(false);
  const [modalKind, setModalKind] = useState<TocKind>("chapter");

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

  /** Reorder root */
  const [rootOrder, setRootOrder] = useState<string[]>([]);
  const [rootReordering, setRootReordering] = useState(false);

  /** Modal chuyển chương vào PHẦN */
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignSection, setAssignSection] = useState<TocItemRoot | null>(null);
  const [assignSelectedChapterIds, setAssignSelectedChapterIds] = useState<
    string[]
  >([]);
  const [assignSaving, setAssignSaving] = useState(false);

  function toggleMenu(id: string) {
    setOpenMenuFor((cur) => (cur === id ? null : id));
  }
  function closeMenu() {
    setOpenMenuFor(null);
  }

  // Đóng menu khi ESC / click ngoài
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

  // ===== Helpers: load versions list =====
  async function refreshVersions(bookIdArg: string) {
    const res = await fetch(`/api/books/versions?book_id=${bookIdArg}`);
    const json = (await res.json().catch(() => ({}))) as Partial<VersionsApiResponse>;

    if (!res.ok || !json.ok) {
      console.error("refreshVersions error:", json.error || res.status);
      setVersions([]);
      setSelectedVersionId("");
      setVersion(null);
      setHasPublishedVersion(false);
      return { ok: false as const, versions: [] as BookVersion[] };
    }

    const vs = (json.versions || []) as BookVersion[];
    setVersions(vs);
    setIsAdmin(!!json.is_admin);
    setBookRole((json.book_role || "viewer") as string);
    setHasPublishedVersion(vs.some((v) => v.status === "published"));

    return { ok: true as const, versions: vs };
  }

  /** Load book + versions + chọn latest */
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

        // 2) Load versions
        const r = await refreshVersions(bookId);
        if (cancelled) return;

        if (!r.ok || r.versions.length === 0) {
          setVersion(null);
          setSelectedVersionId("");
          setSelectedTemplateId("");
          setTocData(null);
          setMembers([]);
          return;
        }

        const latest = r.versions[r.versions.length - 1];
        setVersion(latest);
        setSelectedVersionId(latest.id);
        setSelectedTemplateId(latest.template_id || "");

        // 3) Load TOC tree + members
        await loadTocTree(latest.id, cancelled);
        await loadMembers(latest.id, cancelled);
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
      const json = (await res.json().catch(() => ({}))) as Partial<{
        ok: boolean;
        templates: BookTemplate[];
        error?: string;
      }>;
      if (!res.ok || !json.ok) {
        console.error("load templates error:", (json as any)?.error || res.status);
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

  // Load templates khi đã có version
  useEffect(() => {
    if (!version?.id) return;
    loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version?.id]);

  const isEditor = tocData?.role === "editor";
  const isAuthor = tocData?.role === "author";

  /** Children map + root items */
  const childrenMap = useMemo(
    () => buildChildrenMap(tocData?.items || []),
    [tocData]
  );
  const rootItems = useMemo(() => childrenMap.get(null) || [], [childrenMap]);

  /** Sync rootOrder từ rootItems */
  useEffect(() => {
    setRootOrder(rootItems.map((x) => x.id));
  }, [rootItems]);

  const rootItemsOrdered = useMemo(() => {
    const map = new Map(rootItems.map((x) => [x.id, x]));
    const ordered = rootOrder
      .map((id) => map.get(id))
      .filter(Boolean) as TocItemRoot[];

    const missing = rootItems.filter((x) => !rootOrder.includes(x.id));
    return [...ordered, ...missing];
  }, [rootItems, rootOrder]);

  /** Các chương root (chapter cấp 1, không thuộc PHẦN) – dùng cho assign modal */
  const rootChaptersAlone = useMemo(
    () => rootItems.filter((it) => it.kind === "chapter" && it.parent_id === null),
    [rootItems]
  );

  // ===== Version dropdown: select version =====
  async function handleSelectVersion(versionId: string) {
    setSelectedVersionId(versionId);

    const v = versions.find((x) => x.id === versionId) || null;
    setVersion(v);
    setTocData(null);
    setMembers([]);

    if (!v) {
      setSelectedTemplateId("");
      return;
    }

    setSelectedTemplateId(v.template_id || "");
    await loadTocTree(v.id);
    await loadMembers(v.id);
    await loadTemplates();
  }

  // ===== Delete version rule =====
  const canDeleteSelectedVersion = useMemo(() => {
    if (!version) return false;
    if (version.status === "published") return isAdmin;
    return isAdmin || bookRole === "editor";
  }, [version, isAdmin, bookRole]);

  async function handleDeleteSelectedVersion() {
    if (!version) return;
    if (!canDeleteSelectedVersion) return;

    const ok = confirm(
      `Bạn chắc chắn muốn xóa Phiên bản ${version.version_no} (${version.status})?\n` +
        `Toàn bộ mục lục và nội dung của phiên bản này sẽ bị xóa.`
    );
    if (!ok) return;

    setDeletingVersion(true);
    try {
      const res = await fetch(`/api/books/versions?id=${version.id}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok || !json?.ok) {
        console.error("delete version error:", json);
        alert(json?.error || "Không xóa được phiên bản.");
        return;
      }

      // refresh list + select latest
      const r = await refreshVersions(bookId);
      if (!r.ok || r.versions.length === 0) {
        setVersion(null);
        setSelectedVersionId("");
        setSelectedTemplateId("");
        setTocData(null);
        setMembers([]);
        return;
      }

      const latest = r.versions[r.versions.length - 1];
      setVersion(latest);
      setSelectedVersionId(latest.id);
      setSelectedTemplateId(latest.template_id || "");
      await loadTocTree(latest.id);
      await loadMembers(latest.id);
      await loadTemplates();
    } catch (e: any) {
      console.error("handleDeleteSelectedVersion error:", e);
      alert(e?.message || "Không xóa được phiên bản.");
    } finally {
      setDeletingVersion(false);
    }
  }

  /** Tạo phiên bản đầu tiên */
  async function handleCreateFirstVersion() {
    if (!bookId) return;
    setCreatingVersion(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/books/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId }),
      });

      const json = await res.json().catch(() => ({} as any));
      if (!res.ok || !json?.ok || !json?.version) {
        console.error("create version error:", json);
        setErrorMsg(json?.error || "Không tạo được phiên bản mới.");
        return;
      }

      // refresh list + select new version
      const r = await refreshVersions(bookId);
      const created = json.version as BookVersion;

      setVersion(created);
      setSelectedVersionId(created.id);
      setSelectedTemplateId(created.template_id || "");

      await loadTocTree(created.id);
      await loadMembers(created.id);
      await loadTemplates();

      // đảm bảo hasPublishedVersion theo list mới
      if (r.ok) setHasPublishedVersion(r.versions.some((v) => v.status === "published"));
    } catch (e: any) {
      console.error("handleCreateFirstVersion error:", e);
      setErrorMsg(e?.message || "Lỗi khi tạo phiên bản mới.");
    } finally {
      setCreatingVersion(false);
    }
  }

  /** Tạo phiên bản mới bằng cách clone từ bản published gần nhất */
  async function handleCloneFromPublished() {
    if (!bookId) return;

    setCreatingVersion(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/books/version/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId }),
      });

      const json = await res.json().catch(() => ({} as any));
      if (!res.ok || !json?.ok || !json?.new_version) {
        console.error("clone version error:", json);
        setErrorMsg(json?.error || "Không clone được phiên bản mới.");
        return;
      }

      const v = json.new_version as BookVersion;

      // refresh list + select new version
      await refreshVersions(bookId);
      setVersion(v);
      setSelectedVersionId(v.id);
      setSelectedTemplateId(v.template_id || "");

      await loadTocTree(v.id);
      await loadMembers(v.id);
      await loadTemplates();

      setHasPublishedVersion(true);
    } catch (e: any) {
      console.error("handleCloneFromPublished error:", e);
      setErrorMsg(e?.message || "Lỗi khi clone phiên bản mới.");
    } finally {
      setCreatingVersion(false);
    }
  }

  /** Lưu template cho version hiện tại */
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

      // cập nhật versions[] để dropdown reflect đúng
      setVersions((cur) => cur.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e: any) {
      console.error("handleSaveTemplateForVersion error:", e);
      alert(e?.message || "Không lưu được template.");
    } finally {
      setSavingTemplate(false);
    }
  }

  /** Modal helpers */

  function openCreateModal(parentId: string | null = null, forcedKind?: TocKind) {
    setModalMode("create");
    setModalParentId(parentId);
    setModalItem(null);
    setModalTitle("");
    setModalKind(forcedKind ? forcedKind : "chapter");

    setModalSelectedAuthors([]);
    setModalOriginalAuthors([]);
    setUserSearchQuery("");
    setUserSearchResults([]);
    setUserSearchError(null);
    setModalOpen(true);
  }

  function openCreateSectionModal() {
    openCreateModal(null, "section");
  }

  function handleOpenCreateChild(parent: TocItemRoot) {
    if (parent.kind !== "section") return;
    openCreateModal(parent.id, "chapter");
  }

  async function openEditModal(item: TocItemRoot) {
    setModalMode("edit");
    setModalParentId(item.parent_id);
    setModalItem(item as any);
    setModalTitle(item.title);
    setModalKind((item.kind ?? "chapter") as TocKind);
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

  /** Search user theo email */
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
            kind: modalKind,
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
      const res = await fetch(`/api/toc/item?id=${modalItem.id}`, {
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

  /** Reorder ↑ / ↓ (trên cùng 1 parent) */
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

  /** Reorder root bằng DnD */
  async function handleRootReorder(next: string[], prev: string[]) {
    if (!isEditor) return;
    if (!version?.id || rootReordering) return;

    setRootOrder(next);
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
      setRootOrder(prev);
    } finally {
      setRootReordering(false);
    }
  }

  function getParentTitleById(id: string | null) {
    if (!id || !tocData?.items) return "";
    const found = tocData.items.find((i) => i.id === id);
    return found?.title || "";
  }

  /** Mở modal chọn chương cho PHẦN */
  function handleOpenAssignToSection(section: TocItemRoot) {
    setAssignSection(section);
    setAssignSelectedChapterIds([]);
    setAssignModalOpen(true);
  }

  function handleCloseAssignModal() {
    if (assignSaving) return;
    setAssignModalOpen(false);
    setAssignSection(null);
    setAssignSelectedChapterIds([]);
  }

  async function handleAssignChapters() {
    if (!version || !assignSection) return;
    if (assignSelectedChapterIds.length === 0) {
      alert("Vui lòng chọn ít nhất 1 chương.");
      return;
    }
    setAssignSaving(true);
    try {
      const res = await fetch("/api/toc/move-to-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_version_id: version.id,
          section_id: assignSection.id,
          chapter_ids: assignSelectedChapterIds,
        }),
      });

      if (!res.ok) {
        console.error("move-to-section error", await res.text());
        alert("Không chuyển chương vào phần được.");
        return;
      }

      const json = await res.json().catch(() => ({} as any));
      if (!json.ok) {
        alert(json.error || "Không chuyển chương vào phần được.");
        return;
      }

      await loadTocTree(version.id);
      handleCloseAssignModal();
    } catch (e) {
      console.error("handleAssignChapters exception", e);
      alert("Không chuyển chương vào phần được.");
    } finally {
      setAssignSaving(false);
    }
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
        <a href="/books" className={BTN}>
          ← Quay lại danh sách
        </a>
      </div>
    );
  }

  if (!book) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <p>Không tìm thấy sách.</p>
        <a href="/books" className={BTN}>
          ← Quay lại danh sách
        </a>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Header + version + template selector */}
      <BookHeaderSection
        book={book}
        version={version}
        // ✅ dropdown versions
        versions={versions}
        selectedVersionId={selectedVersionId}
        onSelectVersion={handleSelectVersion}
        // ✅ delete version
        canDeleteSelectedVersion={canDeleteSelectedVersion}
        deletingVersion={deletingVersion}
        onDeleteSelectedVersion={handleDeleteSelectedVersion}
        // templates
        templates={templates}
        templatesLoading={templatesLoading}
        templatesError={templatesError}
        selectedTemplateId={selectedTemplateId}
        savingTemplate={savingTemplate}
        creatingVersion={creatingVersion}
        // clone button (chỉ khi có published và là editor)
        hasPublishedVersion={hasPublishedVersion && isEditor}
        onCreateFirstVersion={handleCreateFirstVersion}
        onCloneFromPublished={handleCloneFromPublished}
        onChangeTemplate={setSelectedTemplateId}
        onSaveTemplateForVersion={handleSaveTemplateForVersion}
      />

      {/* Khi đã có version thì mới có TOC */}
      {version && (
        <div className="space-y-4">
          <TocRootList
            bookId={book.id}
            versionId={version.id}
            role={tocData?.role ?? "viewer"}
            items={tocData?.items ?? []}
            onReload={() => loadTocTree(version.id)}
            onOpenCreateSection={() => openCreateModal(null, "section")}
            onOpenCreateRootChapter={() => openCreateModal(null, "chapter")}
            onOpenCreateChild={(parentId) => openCreateModal(parentId, "chapter")}
            onOpenEdit={openEditModal}
            onOpenCompose={(item) => router.push(`/books/${book.id}/toc/${item.id}`)}
          />
        </div>
      )}

      {/* MODAL tạo / sửa TOC */}
      <TocModal
        open={modalOpen}
        mode={modalMode}
        parentId={modalParentId}
        currentItem={modalItem}
        title={modalTitle}
        onTitleChange={setModalTitle}
        kind={modalKind}
        bookId={book.id}
        loadingAssignments={modalLoadingAssignments}
        members={members}
        memberIdSet={memberIdSet}
        selectedAuthorIds={modalSelectedAuthors}
        onChangeSelectedAuthors={setModalSelectedAuthors}
        userSearchQuery={userSearchQuery}
        onUserSearchQueryChange={setUserSearchQuery}
        userSearchResults={userSearchResults}
        userSearchError={userSearchError}
        userSearchLoading={userSearchLoading}
        onSearchUsers={handleSearchUsers}
        modalSaving={modalSaving}
        modalDeleting={modalDeleting}
        onClose={closeModal}
        onSave={handleSaveToc}
        onDelete={handleDeleteToc}
        getParentTitleById={getParentTitleById}
      />

      {/* MODAL chọn chương đưa vào PHẦN */}
      <AssignChaptersModal
        open={assignModalOpen}
        sectionTitle={assignSection?.title || ""}
        availableChapters={rootChaptersAlone.filter(
          (ch) => ch.id !== assignSection?.id
        )}
        selectedChapterIds={assignSelectedChapterIds}
        assigning={assignSaving}
        onChangeSelected={setAssignSelectedChapterIds}
        onClose={handleCloseAssignModal}
        onConfirm={handleAssignChapters}
      />
    </div>
  );
}
