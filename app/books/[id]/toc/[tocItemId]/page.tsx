// app/books/[id]/toc/[tocItemId]/page.tsx
"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  FormEvent,
  ChangeEvent,
} from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";

type BookRole = "viewer" | "author" | "editor" | null;

type TocItem = {
  id: string;
  book_version_id: string;
  parent_id: string | null;
  title: string;
  slug: string;
  order_index: number;
};

type TocContent = {
  toc_item_id: string;
  content_json: any;
  updated_at: string | null;
  updated_by: string | null;
  status?: "draft" | "submitted" | "needs_revision" | "approved";
  editor_note?: string | null;
  author_resolved?: boolean;
};

type Assignment = {
  id: string;
  toc_item_id: string;
  user_id: string;
  role_in_item: "author" | "editor";
  profile?: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
};

type TocItemResponse = {
  item: TocItem;
  role: BookRole;
  book_id: string;
  book_title: string | null;
  content: TocContent | null;
  assignments: Assignment[];
};

// Sidebar tree item (raw từ /api/toc/tree)
type TocTreeItem = {
  id: string;
  parent_id: string | null;
  title: string;
  slug: string;
  order_index: number;
  created_at?: string | null;
};

type TocTreeNode = TocTreeItem & {
  depth: number;
  children: TocTreeNode[];
};

// Preview từ Word
type ImportPreviewSubsection = {
  title: string;
  html: string;
};

type ImportPreview = {
  rootHtml: string;
  subsections: ImportPreviewSubsection[];
};

const INPUT =
  "w-full border rounded-lg px-3 py-2 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-200";
const BTN =
  "inline-flex items-center justify-center px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed";
const BTN_PRIMARY =
  "inline-flex items-center justify-center px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed";
const CHIP =
  "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold";

export default function TocItemPage() {
  const params = useParams<{ id: string; tocItemId: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const bookId = params.id;
  const tocItemId = params.tocItemId;
  const editorRef = useRef<HTMLDivElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [treeLoading, setTreeLoading] = useState(false);

  const [savingSection, setSavingSection] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [requestingChange, setRequestingChange] = useState(false);
  const [resolvingNote, setResolvingNote] = useState(false);

  const [data, setData] = useState<TocItemResponse | null>(null);

  // Cây TOC (subtree dưới chương này)
  const [treeRoot, setTreeRoot] = useState<TocTreeNode | null>(null);

  // Nội dung HTML cho từng TOC item trong cây
  const [sectionHtml, setSectionHtml] = useState<Record<string, string>>({});
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // GPT state
  const [checkingGPT, setCheckingGPT] = useState(false);
  const [gptResult, setGptResult] = useState<string | null>(null);
  const [gptError, setGptError] = useState<string | null>(null);

  // Editor note
  const [editorNote, setEditorNote] = useState("");
  const contentStatus = (data?.content?.status ?? "draft") as TocContent["status"];
  const editorNoteResolved = data?.content?.author_resolved ?? false;

  const isEditor = data?.role === "editor";
  const isAuthorRole = data?.role === "author";

  // author được phân công cho mục này?
  const isAssignedAuthor = useMemo(() => {
    if (!user || !data) return false;
    return data.assignments.some(
      (a) => a.user_id === user.id && a.role_in_item === "author"
    );
  }, [data, user]);

  const canEditContent = useMemo(() => {
    if (!data) return false;
    if (isEditor) return true;
    if (isAuthorRole && isAssignedAuthor && contentStatus !== "approved") {
      return true;
    }
    return false;
  }, [data, isEditor, isAuthorRole, isAssignedAuthor, contentStatus]);

  const canSubmit =
    isAuthorRole &&
    isAssignedAuthor &&
    (contentStatus === "draft" || contentStatus === "needs_revision");

  const canApprove = isEditor && contentStatus === "submitted";
  const canRequestChange = isEditor && contentStatus === "submitted";

  const canManageSubsections =
    isEditor || (isAuthorRole && isAssignedAuthor);

  const canResolveNote =
    isAuthorRole &&
    isAssignedAuthor &&
    contentStatus === "needs_revision" &&
    !!data?.content?.editor_note &&
    !editorNoteResolved;

  // Import từ Word (.docx)
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importApplying, setImportApplying] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [replaceExistingSubs, setReplaceExistingSubs] = useState(true);

  // Đổi tên mục con
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [renamingSaving, setRenamingSaving] = useState(false);

  // Thêm mục con
  const [newChildParentId, setNewChildParentId] = useState<string | null>(null);
  const [newChildTitle, setNewChildTitle] = useState("");
  const [creatingChild, setCreatingChild] = useState(false);

  function statusLabel(s: TocContent["status"]) {
    switch (s) {
      case "draft":
        return "Bản nháp";
      case "submitted":
        return "Đã nộp – chờ duyệt";
      case "needs_revision":
        return "Cần chỉnh sửa";
      case "approved":
        return "Đã duyệt";
      default:
        return "Không rõ";
    }
  }

  function statusChipClass(s: TocContent["status"]) {
    switch (s) {
      case "draft":
        return `${CHIP} bg-gray-100 text-gray-800`;
      case "submitted":
        return `${CHIP} bg-blue-100 text-blue-800`;
      case "needs_revision":
        return `${CHIP} bg-yellow-100 text-yellow-800`;
      case "approved":
        return `${CHIP} bg-green-100 text-green-800`;
      default:
        return `${CHIP} bg-gray-100 text-gray-800`;
    }
  }

  function stripHtml(html: string) {
    if (!html) return "";
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  function parseContentJson(raw: any): string {
    let html = "<p></p>";
    if (!raw) {
      html = "<p></p>";
    } else if (typeof raw === "string") {
      html = `<p>${raw}</p>`;
    } else if (raw.html) {
      html = String(raw.html);
    } else if (raw.text) {
      html = `<p>${raw.text}</p>`;
    }
    return html || "<p></p>";
  }

  // khi dữ liệu content đổi → sync editorNote state
  useEffect(() => {
    setEditorNote(data?.content?.editor_note ?? "");
  }, [data?.content?.editor_note]);

  // ========================
  // Load mục chính (chương)
  // ========================
  useEffect(() => {
    if (!tocItemId) return;

    const load = async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const res = await fetch(`/api/toc/item?toc_item_id=${tocItemId}`);
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setErrorMsg(j.error || `Lỗi tải dữ liệu (${res.status})`);
          setData(null);
          return;
        }
        const j = (await res.json()) as TocItemResponse;
        setData(j);

        const html = parseContentJson(j.content?.content_json);
        setSectionHtml({ [j.item.id]: html });
        setActiveSectionId(j.item.id);
      } catch (e: any) {
        setErrorMsg(e?.message || "Lỗi không xác định khi tải dữ liệu");
        setData(null);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [tocItemId]);

  // ========================
  // Load cây TOC (subtree) bằng /api/toc/tree
  // ========================
  useEffect(() => {
    if (!data?.item?.book_version_id || !data.item.id) return;

    const loadTree = async () => {
      setTreeLoading(true);
      try {
        const res = await fetch(
          `/api/toc/tree?version_id=${encodeURIComponent(
            data.item.book_version_id
          )}`
        );
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.error) {
          console.error("load TOC tree error:", j.error || res.status);
          setTreeRoot(null);
          return;
        }

        const items: TocTreeItem[] = Array.isArray(j.items) ? j.items : [];
        const root = buildSubtree(items, data.item.id, 0);
        setTreeRoot(root);
      } catch (e) {
        console.error("load TOC tree failed:", e);
        setTreeRoot(null);
      } finally {
        setTreeLoading(false);
      }
    };

    loadTree();
  }, [data?.item?.book_version_id, data?.item?.id]);

  // Khi activeSectionId hoặc sectionHtml thay đổi → sync ra DOM editor
  useEffect(() => {
    if (authLoading || loading) return;
    if (!editorRef.current) return;
    if (!activeSectionId) return;

    const html = sectionHtml[activeSectionId] ?? "<p></p>";
    editorRef.current.innerHTML = html || "<p></p>";
  }, [authLoading, loading, activeSectionId, sectionHtml]);

  // ========================
  // Helpers cho cây TOC
  // ========================
  function buildSubtree(
    items: TocTreeItem[],
    rootId: string,
    depth: number
  ): TocTreeNode | null {
    const root = items.find((i) => i.id === rootId);
    if (!root) return null;

    const childrenRaw = items
      .filter((i) => i.parent_id === rootId)
      .sort((a, b) => a.order_index - b.order_index);

    const children: TocTreeNode[] = childrenRaw
      .map((c) => buildSubtree(items, c.id, depth + 1))
      .filter(Boolean) as TocTreeNode[];

    return { ...root, depth, children };
  }

  function findNodeTitle(node: TocTreeNode | null, id: string | null): string {
    if (!node || !id) return "";
    if (node.id === id) return node.title;
    for (const child of node.children) {
      const t = findNodeTitle(child, id);
      if (t) return t;
    }
    return "";
  }

  function findParentId(
    node: TocTreeNode | null,
    targetId: string,
    parentId: string | null = null
  ): string | null {
    if (!node) return null;
    if (node.id === targetId) return parentId;
    for (const child of node.children) {
      const found = findParentId(child, targetId, node.id);
      if (found) return found;
    }
    return null;
  }

  function updateNodeTitleInTree(
    node: TocTreeNode,
    id: string,
    title: string
  ): TocTreeNode {
    if (node.id === id) {
      return { ...node, title };
    }
    return {
      ...node,
      children: node.children.map((c) =>
        updateNodeTitleInTree(c, id, title)
      ),
    };
  }

  function addChildToTree(
    node: TocTreeNode,
    parentId: string,
    child: TocTreeItem
  ): TocTreeNode {
    if (node.id === parentId) {
      const newChild: TocTreeNode = {
        ...child,
        depth: node.depth + 1,
        children: [],
      };
      const children = [...node.children, newChild].sort(
        (a, b) => a.order_index - b.order_index
      );
      return { ...node, children };
    }
    return {
      ...node,
      children: node.children.map((c) =>
        addChildToTree(c, parentId, child)
      ),
    };
  }

  function removeNodeFromTree(
    node: TocTreeNode,
    targetId: string
  ): TocTreeNode | null {
    if (node.id === targetId) {
      // Không bao giờ xoá root bằng UI, nên trường hợp này không dùng
      return null;
    }
    const filteredChildren: TocTreeNode[] = [];
    for (const child of node.children) {
      if (child.id === targetId) {
        // Bỏ qua child này (và toàn bộ subtree)
        continue;
      }
      const updated = removeNodeFromTree(child, targetId);
      if (updated) filteredChildren.push(updated);
    }
    return { ...node, children: filteredChildren };
  }

  // ========================
  // Helpers cập nhật HTML
  // ========================
  function getActiveHtml(): string {
    if (!activeSectionId) return "<p></p>";
    return sectionHtml[activeSectionId] ?? "<p></p>";
  }

  function updateActiveHtml(newHtml: string) {
    if (!activeSectionId) return;
    setSectionHtml((prev) => ({
      ...prev,
      [activeSectionId]: newHtml,
    }));
  }

  function getActiveTitle(): string {
    if (!data || !activeSectionId) return "";
    return findNodeTitle(treeRoot, activeSectionId) || data.item.title;
  }

  function saveCurrentEditorToState() {
    if (!activeSectionId) return;
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML || "<p></p>";
    setSectionHtml((prev) => ({
      ...prev,
      [activeSectionId]: html,
    }));
  }

  // ========================
  // Toolbar: execCommand helpers
  // ========================
  function applyCommand(command: string, value?: string) {
    if (!canEditContent) return;
    const el = editorRef.current;
    if (!el) return;

    el.focus();
    if (value !== undefined) {
      document.execCommand(command, false, value);
    } else {
      document.execCommand(command, false);
    }
    // sync lại state sau khi format
    const html = el.innerHTML || "<p></p>";
    updateActiveHtml(html);
  }

  // ========================
  // API actions
  // ========================
  async function saveOne(tocId: string, html: string) {
    const res = await fetch("/api/toc/content/upsert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toc_item_id: tocId,
        content_json: {
          type: "richtext",
          html,
        },
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) {
      throw new Error(j.error || "Lưu nội dung thất bại");
    }
  }

  async function handleSaveCurrent() {
    if (!activeSectionId) return;
    setSavingSection(true);
    setErrorMsg(null);
    try {
      // lấy HTML mới nhất từ editorRef
      if (editorRef.current) {
        const html = editorRef.current.innerHTML || "<p></p>";
        await saveOne(activeSectionId, html);
        updateActiveHtml(html);
      } else {
        const html = getActiveHtml();
        await saveOne(activeSectionId, html);
      }
    } catch (e: any) {
      setErrorMsg(e?.message || "Lỗi khi lưu nội dung");
    } finally {
      setSavingSection(false);
    }
  }

  async function handleSaveAll() {
    if (!data?.item?.id) return;
    setSavingAll(true);
    setErrorMsg(null);
    try {
      // Lưu lại section đang mở
      saveCurrentEditorToState();

      const tasks: Promise<void>[] = [];
      const entries = Object.entries(sectionHtml);

      for (const [tocId, html] of entries) {
        const content = html || "<p></p>";
        tasks.push(saveOne(tocId, content));
      }

      if (tasks.length === 0) {
        // luôn lưu ít nhất chương chính
        tasks.push(saveOne(data.item.id, getActiveHtml()));
      }

      await Promise.all(tasks);
    } catch (e: any) {
      setErrorMsg(e?.message || "Lỗi khi lưu chương");
    } finally {
      setSavingAll(false);
    }
  }

  async function handleSubmitChapter() {
    if (!data?.item?.id) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await handleSaveAll();

      const res = await fetch("/api/toc/content/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toc_item_id: data.item.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setErrorMsg(j.error || "Nộp chương thất bại");
      } else {
        const r = await fetch(`/api/toc/item?toc_item_id=${data.item.id}`);
        if (r.ok) {
          const j2 = (await r.json()) as TocItemResponse;
          setData(j2);
        }
      }
    } catch (e: any) {
      setErrorMsg(e?.message || "Lỗi khi nộp chương");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApproveChapter() {
    if (!data?.item?.id) return;
    if (
      !window.confirm(
        "Duyệt chương này? Sau khi duyệt, tác giả sẽ không thể chỉnh sửa."
      )
    ) {
      return;
    }
    setApproving(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/toc/content/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toc_item_id: data.item.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setErrorMsg(j.error || "Duyệt nội dung thất bại");
      } else {
        const r = await fetch(`/api/toc/item?toc_item_id=${data.item.id}`);
        if (r.ok) {
          const j2 = (await r.json()) as TocItemResponse;
          setData(j2);
        }
      }
    } catch (e: any) {
      setErrorMsg(e?.message || "Lỗi khi duyệt chương");
    } finally {
      setApproving(false);
    }
  }

  async function handleRequestChangeChapter() {
    if (!data?.item?.id) return;
    setRequestingChange(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/toc/content/request-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toc_item_id: data.item.id,
          editor_note: editorNote,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setErrorMsg(j.error || "Yêu cầu chỉnh sửa thất bại");
      } else {
        const r = await fetch(`/api/toc/item?toc_item_id=${data.item.id}`);
        if (r.ok) {
          const j2 = (await r.json()) as TocItemResponse;
          setData(j2);
        }
      }
    } catch (e: any) {
      setErrorMsg(e?.message || "Lỗi khi yêu cầu chỉnh sửa");
    } finally {
      setRequestingChange(false);
    }
  }

  async function handleGPTCheckChapter() {
    setCheckingGPT(true);
    setGptError(null);
    setGptResult(null);
    try {
      // lưu lại đoạn đang mở
      saveCurrentEditorToState();

      const texts: string[] = [];
      for (const html of Object.values(sectionHtml)) {
        if (!html) continue;
        texts.push(stripHtml(html));
      }
      const text = texts.filter(Boolean).join("\n\n");
      if (!text) {
        setGptError("Không có nội dung để kiểm tra.");
        return;
      }

      const res = await fetch("/api/gpt/check-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setGptError(j.error || "GPT kiểm tra thất bại");
      } else {
        setGptResult(j.feedback || "");
      }
    } catch (e: any) {
      setGptError(e?.message || "Lỗi khi gọi GPT");
    } finally {
      setCheckingGPT(false);
    }
  }

  async function handleResolveNote() {
    if (!data?.item?.id) return;
    setResolvingNote(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/toc/content/resolve-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toc_item_id: data.item.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setErrorMsg(j.error || "Không đánh dấu được ghi chú là đã giải quyết");
      } else {
        const r = await fetch(`/api/toc/item?toc_item_id=${data.item.id}`);
        if (r.ok) {
          const j2 = (await r.json()) as TocItemResponse;
          setData(j2);
        }
      }
    } catch (e: any) {
      setErrorMsg(e?.message || "Lỗi khi đánh dấu đã giải quyết");
    } finally {
      setResolvingNote(false);
    }
  }

  // ========================
  // Mục con: thêm / sửa / xoá
  // ========================
  async function handleCreateChild(parentId: string, title: string) {
    if (!parentId || !title.trim()) return;
    setCreatingChild(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/toc/subsections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parent_id: parentId,
          title: title.trim(),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error || !j.item) {
        setErrorMsg(j.error || "Tạo mục con thất bại");
        return;
      }

      const item: TocTreeItem = j.item;
      setTreeRoot((prev) =>
        prev ? addChildToTree(prev, parentId, item) : prev
      );
      // nội dung mới trống
      setSectionHtml((prev) => ({
        ...prev,
        [item.id]: "<p></p>",
      }));
      setActiveSectionId(item.id);
    } catch (e: any) {
      setErrorMsg(e?.message || "Lỗi khi tạo mục con");
    } finally {
      setCreatingChild(false);
      setNewChildParentId(null);
      setNewChildTitle("");
    }
  }

  async function handleDeleteNode(id: string, title: string) {
    if (
      !window.confirm(
        `Xoá mục "${title}"? Các mục con sâu hơn (nếu có) cũng sẽ bị xoá.`
      )
    ) {
      return;
    }
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/toc/subsections?id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setErrorMsg(j.error || "Xoá mục con thất bại");
        return;
      }

      const parentId = findParentId(treeRoot, id);
      setTreeRoot((prev) => (prev ? removeNodeFromTree(prev, id) : prev));

      setSectionHtml((prev) => {
        const clone = { ...prev };
        delete clone[id];
        return clone;
      });

      if (activeSectionId === id) {
        setActiveSectionId(parentId || (data?.item.id ?? null));
      }
    } catch (e: any) {
      setErrorMsg(e?.message || "Lỗi khi xoá mục con");
    }
  }

  async function handleRenameNode(id: string, newTitle: string) {
    if (!id || !newTitle.trim()) return;
    setRenamingSaving(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/toc/subsections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, title: newTitle.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error || !j.item) {
        setErrorMsg(j.error || "Đổi tên mục con thất bại");
        return;
      }
      const updated: TocTreeItem = j.item;
      setTreeRoot((prev) =>
        prev ? updateNodeTitleInTree(prev, id, updated.title) : prev
      );
      setRenamingId(null);
      setRenamingTitle("");
    } catch (e: any) {
      setErrorMsg(e?.message || "Lỗi khi đổi tên mục con");
    } finally {
      setRenamingSaving(false);
    }
  }

  function startRename(node: TocTreeNode) {
    setRenamingId(node.id);
    setRenamingTitle(node.title);
  }

  // ========================
  // Chọn section trong tree
  // ========================
  async function handleSelectSection(id: string) {
    if (!id) return;
    if (id === activeSectionId) return;

    // lưu lại nội dung section hiện tại
    saveCurrentEditorToState();

    setActiveSectionId(id);

    // nếu chưa có html trong state, fetch về
    if (!sectionHtml[id]) {
      try {
        const res = await fetch(`/api/toc/item?toc_item_id=${id}`);
        if (!res.ok) return;
        const j = (await res.json()) as TocItemResponse;
        const html = parseContentJson(j.content?.content_json);
        setSectionHtml((prev) => ({
          ...prev,
          [id]: html,
        }));
      } catch (e) {
        console.error("load section content error:", e);
      }
    }
  }

  // ========================
  // Import từ Word (.docx)
  // ========================
  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] || null;
    setImportFile(f);
    setImportPreview(null);
    setImportError(null);
  }

  async function handleImportPreview() {
    if (!data?.item?.id) return;
    if (!importFile) {
      setImportError("Vui lòng chọn file .docx trước.");
      return;
    }
    setImportLoading(true);
    setImportError(null);
    setImportPreview(null);
    try {
      const form = new FormData();
      form.append("file", importFile);
      form.append("toc_item_id", data.item.id);

      const res = await fetch("/api/toc/import-docx/preview", {
        method: "POST",
        body: form,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setImportError(j.error || "Không parse được file Word.");
      } else {
        const preview: ImportPreview = {
          rootHtml: j.rootHtml || "<p></p>",
          subsections: Array.isArray(j.subsections)
            ? j.subsections
            : [],
        };
        setImportPreview(preview);
      }
    } catch (e: any) {
      setImportError(e?.message || "Lỗi khi upload / parse file Word.");
    } finally {
      setImportLoading(false);
    }
  }

  async function handleImportApply() {
    if (!data?.item?.id || !importPreview) return;
    setImportApplying(true);
    setImportError(null);
    try {
      const res = await fetch("/api/toc/import-docx/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toc_item_id: data.item.id,
          rootHtml: importPreview.rootHtml,
          subsections: importPreview.subsections,
          replaceExisting: replaceExistingSubs,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setImportError(j.error || "Không áp dụng được nội dung từ Word.");
        return;
      }

      // Reload lại dữ liệu chương + cây TOC
      try {
        const mainRes = await fetch(
          `/api/toc/item?toc_item_id=${data.item.id}`
        );
        if (mainRes.ok) {
          const j2 = (await mainRes.json()) as TocItemResponse;
          setData(j2);
          const html = parseContentJson(j2.content?.content_json);
          setSectionHtml({ [j2.item.id]: html });
          setActiveSectionId(j2.item.id);
        }

        if (data.item.book_version_id) {
          const treeRes = await fetch(
            `/api/toc/tree?version_id=${encodeURIComponent(
              data.item.book_version_id
            )}`
          );
          const tj = await treeRes.json().catch(() => ({}));
          if (treeRes.ok && !tj.error) {
            const items: TocTreeItem[] = Array.isArray(tj.items)
              ? tj.items
              : [];
            const root = buildSubtree(items, data.item.id, 0);
            setTreeRoot(root);
          }
        }
      } catch (reloadErr) {
        console.error("reload after import-docx apply failed:", reloadErr);
      }

      // clear preview & file
      setImportPreview(null);
      setImportFile(null);
    } catch (e: any) {
      setImportError(e?.message || "Lỗi khi áp dụng dữ liệu từ Word.");
    } finally {
      setImportApplying(false);
    }
  }

  // ========================
  // Render tree sidebar
  // ========================
  function renderTree(node: TocTreeNode): JSX.Element {
    const isActive = node.id === activeSectionId;
    const isRoot = node.parent_id === null || node.id === data?.item.id;
    const canRenameHere = canManageSubsections && !isRoot;
    const canDeleteHere = canManageSubsections && !isRoot;
    const canAddChildHere = canManageSubsections;

    const paddingLeft = 8 + node.depth * 12;

    return (
      <div key={node.id} className="space-y-1">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={`flex-1 text-left px-2 py-1.5 rounded-md border text-sm ${
              isActive
                ? "border-blue-500 bg-blue-50 text-blue-800"
                : "border-transparent hover:bg-gray-50 text-gray-700"
            }`}
            style={{ paddingLeft }}
            onClick={() => handleSelectSection(node.id)}
          >
            <div className="text-[11px] text-gray-400">
              {node.depth === 0 ? "Chương" : `Mục #${node.order_index}`}
            </div>
            <div className="font-medium truncate">{node.title}</div>
          </button>
          {canAddChildHere && (
            <button
              type="button"
              className="px-1.5 py-1 text-[11px] border rounded-md bg-gray-50 hover:bg-gray-100 text-gray-700"
              title="Thêm mục con"
              onClick={() => {
                setNewChildParentId(node.id);
                setNewChildTitle("");
              }}
            >
              +
            </button>
          )}
          {canRenameHere && (
            <button
              type="button"
              className="px-1.5 py-1 text-[11px] border rounded-md bg-gray-50 hover:bg-gray-100 text-gray-700"
              title="Đổi tên mục"
              onClick={() => startRename(node)}
            >
              ✎
            </button>
          )}
          {canDeleteHere && (
            <button
              type="button"
              className="px-1.5 py-1 text-[11px] border rounded-md bg-red-50 hover:bg-red-100 text-red-600"
              title="Xoá mục"
              onClick={() => handleDeleteNode(node.id, node.title)}
            >
              🗑
            </button>
          )}
        </div>

        {/* Form đổi tên inline */}
        {renamingId === node.id && (
          <form
            className="flex items-center gap-2 text-xs"
            onSubmit={(e) => {
              e.preventDefault();
              if (!renamingTitle.trim() || renamingSaving) return;
              handleRenameNode(node.id, renamingTitle);
            }}
          >
            <input
              className={`${INPUT} h-7 text-xs`}
              value={renamingTitle}
              onChange={(e) => setRenamingTitle(e.target.value)}
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

        {/* Form thêm mục con inline */}
        {newChildParentId === node.id && (
          <form
            className="flex items-center gap-2 text-xs"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newChildTitle.trim() || creatingChild) return;
              handleCreateChild(node.id, newChildTitle);
            }}
          >
            <input
              className={`${INPUT} h-7 text-xs`}
              placeholder="Tiêu đề mục con..."
              value={newChildTitle}
              onChange={(e) => setNewChildTitle(e.target.value)}
            />
            <button
              type="submit"
              className="px-2 py-1 rounded-md bg-blue-600 text-white text-[11px] hover:bg-blue-700 disabled:opacity-50"
              disabled={creatingChild || !newChildTitle.trim()}
            >
              {creatingChild ? "Đang tạo..." : "Thêm"}
            </button>
            <button
              type="button"
              className="px-2 py-1 rounded-md border text-[11px] hover:bg-gray-50"
              onClick={() => {
                setNewChildParentId(null);
                setNewChildTitle("");
              }}
            >
              Hủy
            </button>
          </form>
        )}

        {node.children.length > 0 && (
          <div className="space-y-1">
            {node.children.map((child) => renderTree(child))}
          </div>
        )}
      </div>
    );
  }

  // ========================
  // Render
  // ========================
  if (authLoading || loading) {
    return (
      <main className="max-w-6xl mx-auto px-4 py-8">
        <p className="text-gray-600">Đang tải...</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="max-w-6xl mx-auto px-4 py-8">
        {errorMsg ? (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {errorMsg}
          </div>
        ) : null}
        <p className="text-gray-600">
          Không tìm thấy nội dung cho mục này.
        </p>
        <div className="mt-4">
          <button className={BTN} onClick={() => router.back()}>
            ← Quay lại
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      {/* Breadcrumb + Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="space-y-2">
          <div className="text-sm text-gray-500">
            <Link href="/books" className="hover:underline">
              Sách của tôi
            </Link>
            <span className="mx-1">/</span>
            <Link
              href={`/books/${bookId}`}
              className="hover:underline"
            >
              {data.book_title || "Sách"}
            </Link>
            <span className="mx-1">/</span>
            <span className="text-gray-700">
              {data.item.title}
            </span>
          </div>
          <h1 className="text-2xl font-bold">
            {data.item.title}
          </h1>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={statusChipClass(contentStatus)}>
              {statusLabel(contentStatus)}
            </span>
            {data.role && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
                Vai trò ở cấp sách: {data.role}
              </span>
            )}
          </div>

          {/* Thành viên biên soạn */}
          <section className="mt-3 bg-white rounded-lg border border-gray-200 shadow-sm p-3 space-y-2">
            <h2 className="text-sm font-semibold text-gray-800">
              Thành viên được phân công cho chương này
            </h2>
            {data.assignments.length === 0 ? (
              <p className="text-xs text-gray-500">
                Chưa có ai được phân công cho mục này.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.assignments.map((a) => {
                  const isMe = user && a.user_id === user.id;
                  const label =
                    a.profile?.name ||
                    a.profile?.email ||
                    a.user_id;
                  return (
                    <li
                      key={a.id}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <span className="font-medium">
                        {label}
                        {isMe ? " (Bạn)" : ""}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                        {a.role_in_item === "author"
                          ? "Author"
                          : "Editor"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <div className="flex flex-col items-end gap-2 text-xs text-gray-500">
          {data.content?.updated_at && (
            <div>
              Cập nhật lần cuối:{" "}
              {new Date(
                data.content.updated_at
              ).toLocaleString()}
            </div>
          )}
          <button className={BTN} onClick={() => router.back()}>
            ← Quay lại sách
          </button>
        </div>
      </div>

      {/* Thông báo lỗi chung */}
      {errorMsg && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      {/* GHI CHÚ CỦA EDITOR */}
      <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-800">
            Ghi chú của editor
          </h3>
          {data.content?.editor_note && (
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                editorNoteResolved
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-yellow-50 text-yellow-700 border border-yellow-200"
              }`}
            >
              {editorNoteResolved
                ? "Tác giả đã đánh dấu: Đã giải quyết"
                : "Chưa đánh dấu đã giải quyết"}
            </span>
          )}
        </div>

        {/* Editor thấy textarea để nhập ghi chú */}
        {isEditor ? (
          <div className="space-y-2">
            <p className="text-xs text-gray-500">
              Ghi chú này sẽ gửi cho tác giả khi bạn bấm{" "}
              <strong>“Yêu cầu chỉnh sửa chương”</strong>.
            </p>
            <textarea
              className={`${INPUT} text-sm min-h-[100px]`}
              placeholder="Ví dụ: Cần bổ sung thêm tài liệu tham khảo ở mục 1.2, chỉnh lại cấu trúc đoạn 3 cho rõ ràng hơn..."
              value={editorNote}
              onChange={(e) => setEditorNote(e.target.value)}
            />
          </div>
        ) : (
          // Tác giả / viewer xem ghi chú dạng readonly
          <div className="space-y-2 text-sm">
            {data.content?.editor_note ? (
              <p className="whitespace-pre-wrap text-gray-800">
                {data.content.editor_note}
              </p>
            ) : (
              <p className="text-xs text-gray-500">
                Chưa có ghi chú nào từ editor cho chương này.
              </p>
            )}
          </div>
        )}

        {/* Nút ĐÃ GIẢI QUYẾT cho Author */}
        {canResolveNote && (
          <div className="pt-2">
            <button
              className={BTN_PRIMARY}
              onClick={handleResolveNote}
              disabled={resolvingNote}
            >
              {resolvingNote
                ? "Đang đánh dấu đã giải quyết..."
                : "Đánh dấu đã giải quyết ghi chú"}
            </button>
          </div>
        )}
      </section>

      {/* Khu vực soạn thảo: sidebar tree + editor */}
      <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-6">
        <div className="grid grid-cols-1 md:grid-cols-[280px,1fr] gap-6">
          {/* Sidebar: cây mục */}
          <aside className="flex flex-col border-b md:border-b-0 md:border-r border-gray-100 pb-4 md:pb-0 md:pr-4 md:max-h-[560px] md:overflow-y-auto">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-800">
                Cấu trúc chương này
              </h3>
              {treeLoading && (
                <span className="text-[11px] text-gray-400">
                  Đang tải cây mục lục...
                </span>
              )}
            </div>

            <p className="text-[11px] text-gray-500 mt-1">
              Bấm vào từng mục để chỉnh nội dung. Dùng nút{" "}
              <span className="font-semibold">+</span> để thêm
              mục con, ✎ để đổi tên, 🗑 để xoá.
            </p>

            <div className="mt-3 text-sm flex-1 overflow-y-auto space-y-1">
              {treeRoot ? (
                renderTree(treeRoot)
              ) : (
                <p className="text-xs text-gray-500">
                  Chưa có mục con nào trong chương này.
                </p>
              )}
            </div>
          </aside>

          {/* Editor cho section đang chọn */}
          <div className="flex flex-col gap-4 md:max-h-[560px] md:overflow-y-auto">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold text-lg">
                  Nội dung: {getActiveTitle()}
                </h2>
                <p className="text-xs text-gray-500">
                  Bạn đang chỉnh sửa phần{" "}
                  {activeSectionId === data.item.id
                    ? "chương chính"
                    : "một mục con trong chương"}
                  .
                </p>
              </div>
              {canEditContent ? (
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
                onClick={() => applyCommand("bold")}
                disabled={!canEditContent}
              >
                B
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded hover:bg-gray-200 italic"
                onClick={() => applyCommand("italic")}
                disabled={!canEditContent}
              >
                I
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded hover:bg-gray-200 underline"
                onClick={() => applyCommand("underline")}
                disabled={!canEditContent}
              >
                U
              </button>
              <span className="h-6 w-px bg-gray-300 mx-1" />
              <button
                type="button"
                className="px-2 py-1 rounded hover:bg-gray-200"
                onClick={() => applyCommand("insertUnorderedList")}
                disabled={!canEditContent}
              >
                • Bullet
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded hover:bg-gray-200"
                onClick={() => applyCommand("insertOrderedList")}
                disabled={!canEditContent}
              >
                1.2.3
              </button>
              <span className="h-6 w-px bg-gray-300 mx-1" />
              <button
                type="button"
                className="px-2 py-1 rounded hover:bg-gray-200"
                onClick={() => applyCommand("formatBlock", "H2")}
                disabled={!canEditContent}
              >
                H2
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded hover:bg-gray-200"
                onClick={() => applyCommand("formatBlock", "H3")}
                disabled={!canEditContent}
              >
                H3
              </button>
            </div>

            {/* contentEditable */}
            <div
              ref={editorRef}
              className={`${INPUT} min-h-[260px] max-h-[360px] leading-relaxed text-sm whitespace-pre-wrap overflow-y-auto`}
              contentEditable={canEditContent}
              suppressContentEditableWarning
              onInput={(e) =>
                updateActiveHtml(e.currentTarget.innerHTML)
              }
            />

            {/* Nút lưu phần hiện tại */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                className={BTN_PRIMARY}
                onClick={handleSaveCurrent}
                disabled={!canEditContent || savingSection}
              >
                {savingSection
                  ? "Đang lưu phần này..."
                  : "Lưu nội dung phần đang chọn"}
              </button>
              <button
                className={BTN}
                onClick={() => setActiveSectionId(data.item.id)}
              >
                Về chương chính
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Khối hành động cho CẢ CHƯƠNG */}
      <section className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
        <h3 className="font-semibold text-sm text-slate-800">
          Hành động cho cả chương
        </h3>
        <p className="text-xs text-slate-600">
          Các nút bên dưới áp dụng cho chương hiện tại và
          tất cả mục con bên trong chương này (cho những mục
          mà bạn đã mở / chỉnh sửa nội dung).
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            className={BTN_PRIMARY}
            onClick={handleSaveAll}
            disabled={!canEditContent || savingAll}
          >
            {savingAll
              ? "Đang lưu cả chương..."
              : "Lưu bản nháp chương"}
          </button>

          <button
            className={BTN}
            onClick={handleSubmitChapter}
            disabled={!canSubmit || submitting}
          >
            {submitting
              ? "Đang nộp chương..."
              : "Nộp chương cho editor"}
          </button>

          <button
            className={BTN}
            onClick={handleGPTCheckChapter}
            disabled={checkingGPT}
          >
            {checkingGPT
              ? "GPT đang kiểm tra chương..."
              : "GPT kiểm tra chương"}
          </button>
        </div>

        {(gptError || gptResult) && (
          <div className="space-y-2">
            {gptError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                {gptError}
              </div>
            )}
            {gptResult && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-900 whitespace-pre-wrap">
                {gptResult}
              </div>
            )}
          </div>
        )}

        {/* Import từ Word (.docx) */}
        {canEditContent && canManageSubsections && (
          <div className="mt-4 border-t border-slate-200 pt-4 space-y-3">
            <h4 className="text-sm font-semibold text-slate-800">
              Import nội dung từ file Word (.docx)
            </h4>
            <p className="text-xs text-slate-600">
              Dùng khi bạn đã có bản thảo chương trong Word với heading
              chuẩn. Hệ thống sẽ đọc nội dung, tách thành chương + mục con
              theo heading, cho xem trước, sau đó mới ghi vào DB.
            </p>

            <div className="flex flex-col md:flex-row gap-3 md:items-center">
              <input
                type="file"
                accept=".docx"
                onChange={handleFileChange}
                className="text-xs"
              />
              <button
                className={BTN}
                onClick={handleImportPreview}
                disabled={importLoading || !importFile}
              >
                {importLoading
                  ? "Đang đọc file Word..."
                  : "Xem trước nội dung từ Word"}
              </button>

              {importPreview && (
                <button
                  className={BTN_PRIMARY}
                  onClick={handleImportApply}
                  disabled={importApplying}
                >
                  {importApplying
                    ? "Đang áp dụng..."
                    : "Áp dụng vào chương này"}
                </button>
              )}
            </div>

            {importPreview && (
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300"
                    checked={replaceExistingSubs}
                    onChange={(e) =>
                      setReplaceExistingSubs(e.target.checked)
                    }
                  />
                  Xoá toàn bộ mục con hiện tại và tạo lại từ file Word
                </label>
              </div>
            )}

            {importError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                {importError}
              </div>
            )}

            {importPreview && (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="space-y-2">
                  <h5 className="font-semibold text-slate-800">
                    Xem trước nội dung chương (root)
                  </h5>
                  <div className="border rounded-lg bg-white p-3 max-h-72 overflow-auto text-sm">
                    <div
                      dangerouslySetInnerHTML={{
                        __html: importPreview.rootHtml || "<p></p>",
                      }}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <h5 className="font-semibold text-slate-800">
                    Các mục con sẽ được tạo ({importPreview.subsections.length})
                  </h5>
                  <div className="border rounded-lg bg-white p-3 max-h-72 overflow-auto space-y-3 text-sm">
                    {importPreview.subsections.length === 0 && (
                      <p className="text-xs text-slate-500">
                        Không có mục con nào được phát hiện từ heading.
                      </p>
                    )}
                    {importPreview.subsections.map((s, idx) => (
                      <div
                        key={`${idx}-${s.title}`}
                        className="border-b border-slate-100 pb-2 last:border-b-0"
                      >
                        <div className="font-semibold text-slate-800 mb-1">
                          {idx + 1}. {s.title || "(Không tiêu đề)"}
                        </div>
                        <div
                          className="prose prose-sm max-w-none"
                          dangerouslySetInnerHTML={{
                            __html: s.html || "<p></p>",
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Panel hành động của Editor */}
      {isEditor && (
        <section className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
          <h3 className="font-semibold text-sm text-slate-800">
            Hành động của Editor (cho cả chương)
          </h3>
          <p className="text-xs text-slate-600">
            Chỉ editor mới thấy phần này. Bạn có thể duyệt hoặc
            yêu cầu tác giả chỉnh sửa khi trạng thái chương đang
            là <strong>Đã nộp</strong>.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className={BTN_PRIMARY}
              onClick={handleApproveChapter}
              disabled={!canApprove || approving}
            >
              {approving ? "Đang duyệt..." : "Duyệt chương"}
            </button>
            <button
              className={BTN}
              onClick={handleRequestChangeChapter}
              disabled={!canRequestChange || requestingChange}
            >
              {requestingChange
                ? "Đang gửi yêu cầu..."
                : "Yêu cầu chỉnh sửa chương"}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
