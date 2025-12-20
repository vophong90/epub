// app/books/[id]/toc/[tocItemId]/page.tsx
"use client";

import {
  useEffect,
  useMemo,
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

type SubItem = {
  id: string;
  parent_id: string | null;
  title: string;
  slug: string;
  order_index: number;
};

type SubItemWithContent = SubItem & {
  editorHtml: string;
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

  const [loading, setLoading] = useState(true);
  const [subLoading, setSubLoading] = useState(false);

  const [savingSection, setSavingSection] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [requestingChange, setRequestingChange] = useState(false);
  const [resolvingNote, setResolvingNote] = useState(false);

  const [data, setData] = useState<TocItemResponse | null>(null);

  // Editor state
  const [rootHtml, setRootHtml] = useState("<p></p>");
  const [subItems, setSubItems] = useState<SubItemWithContent[]>([]);
  const [activeSectionId, setActiveSectionId] = useState<"root" | string>(
    "root"
  );

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
  // Load mục chính
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
        setRootHtml(html);
        setActiveSectionId("root");
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
  // Load mục con + nội dung
  // ========================
  useEffect(() => {
    if (!tocItemId) return;

    const loadSubs = async () => {
      setSubLoading(true);
      try {
        const res = await fetch(
          `/api/toc/subsections?parent_id=${tocItemId}`
        );
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.error) {
          console.error("load subsections error:", j.error || res.status);
          setSubItems([]);
          return;
        }
        const bareItems: SubItem[] = j.items || [];

        const withContent: SubItemWithContent[] = await Promise.all(
          bareItems.map(async (s) => {
            try {
              const r = await fetch(`/api/toc/item?toc_item_id=${s.id}`);
              if (!r.ok) {
                return { ...s, editorHtml: "<p></p>" };
              }
              const tj = (await r.json()) as TocItemResponse;
              const html = parseContentJson(
                tj.content?.content_json
              );
              return { ...s, editorHtml: html };
            } catch {
              return { ...s, editorHtml: "<p></p>" };
            }
          })
        );

        withContent.sort((a, b) => a.order_index - b.order_index);
        setSubItems(withContent);
      } catch (e) {
        console.error("load subsections failed:", e);
        setSubItems([]);
      } finally {
        setSubLoading(false);
      }
    };

    loadSubs();
  }, [tocItemId]);

  // ========================
  // Helpers cập nhật HTML
  // ========================
  function updateActiveHtml(newHtml: string) {
    if (activeSectionId === "root") {
      setRootHtml(newHtml);
    } else {
      setSubItems((prev) =>
        prev.map((s) =>
          s.id === activeSectionId ? { ...s, editorHtml: newHtml } : s
        )
      );
    }
  }

  function getActiveHtml(): string {
    if (activeSectionId === "root") return rootHtml;
    const sub = subItems.find((s) => s.id === activeSectionId);
    return sub?.editorHtml ?? "<p></p>";
  }

  function getActiveTitle(): string {
    if (!data) return "";
    if (activeSectionId === "root") {
      return data.item.title;
    }
    const sub = subItems.find((s) => s.id === activeSectionId);
    return sub?.title ?? data.item.title;
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
    if (!tocItemId) return;
    setSavingSection(true);
    setErrorMsg(null);
    try {
      const html = getActiveHtml();
      const targetId = activeSectionId === "root" ? tocItemId : activeSectionId;
      await saveOne(targetId, html);
    } catch (e: any) {
      setErrorMsg(e?.message || "Lỗi khi lưu nội dung");
    } finally {
      setSavingSection(false);
    }
  }

  async function handleSaveAll() {
    if (!tocItemId) return;
    setSavingAll(true);
    setErrorMsg(null);
    try {
      const tasks: Promise<void>[] = [];
      tasks.push(saveOne(tocItemId, rootHtml));
      for (const s of subItems) {
        tasks.push(saveOne(s.id, s.editorHtml));
      }
      await Promise.all(tasks);
    } catch (e: any) {
      setErrorMsg(e?.message || "Lỗi khi lưu chương");
    } finally {
      setSavingAll(false);
    }
  }

  async function handleSubmitChapter() {
    if (!tocItemId) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await handleSaveAll();

      const res = await fetch("/api/toc/content/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toc_item_id: tocItemId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setErrorMsg(j.error || "Nộp nội dung thất bại");
      } else {
        const r = await fetch(`/api/toc/item?toc_item_id=${tocItemId}`);
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
    if (!tocItemId) return;
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
        body: JSON.stringify({ toc_item_id: tocItemId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setErrorMsg(j.error || "Duyệt nội dung thất bại");
      } else {
        const r = await fetch(`/api/toc/item?toc_item_id=${tocItemId}`);
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
    if (!tocItemId) return;
    setRequestingChange(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/toc/content/request-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toc_item_id: tocItemId,
          editor_note: editorNote,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setErrorMsg(j.error || "Yêu cầu chỉnh sửa thất bại");
      } else {
        const r = await fetch(`/api/toc/item?toc_item_id=${tocItemId}`);
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
      const pieces: string[] = [];
      pieces.push(stripHtml(rootHtml));
      for (const s of subItems) {
        pieces.push(stripHtml(s.editorHtml));
      }
      const text = pieces.filter(Boolean).join("\n\n");
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
    if (!tocItemId) return;
    setResolvingNote(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/toc/content/resolve-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toc_item_id: tocItemId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setErrorMsg(j.error || "Không đánh dấu được ghi chú là đã giải quyết");
      } else {
        const r = await fetch(`/api/toc/item?toc_item_id=${tocItemId}`);
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
  // Mục con: thêm / xoá
  // ========================
  async function handleCreateSub(title: string) {
    if (!tocItemId || !title.trim()) return;
    setSubLoading(true);
    try {
      const res = await fetch("/api/toc/subsections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parent_id: tocItemId,
          title: title.trim(),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setErrorMsg(j.error || "Tạo mục con thất bại");
      } else if (j.item) {
        const s: SubItemWithContent = {
          ...j.item,
          editorHtml: "<p></p>",
        };
        setSubItems((prev) =>
          [...prev, s].sort(
            (a, b) => a.order_index - b.order_index
          )
        );
      }
    } catch (e: any) {
      setErrorMsg(e?.message || "Lỗi khi tạo mục con");
    } finally {
      setSubLoading(false);
    }
  }

  async function handleDeleteSub(id: string) {
    if (
      !window.confirm(
        "Xoá mục con này? Các mục con sâu hơn (nếu có) cũng sẽ bị xoá."
      )
    ) {
      return;
    }
    try {
      const res = await fetch(
        `/api/toc/subsections?id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setErrorMsg(j.error || "Xoá mục con thất bại");
      } else {
        setSubItems((prev) =>
          prev.filter((s) => s.id !== id)
        );
        if (activeSectionId === id) {
          setActiveSectionId("root");
        }
      }
    } catch (e: any) {
      setErrorMsg(e?.message || "Lỗi khi xoá mục con");
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
    if (!tocItemId) return;
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
      form.append("toc_item_id", tocItemId);

      // Nếu bạn đặt API dưới /api/toc/import-docx/preview
      // thì đổi URL lại cho khớp.
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
    if (!tocItemId || !importPreview) return;
    setImportApplying(true);
    setImportError(null);
    try {
      const res = await fetch("/api/import-docx/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toc_item_id: tocItemId,
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

      // Reload lại dữ liệu từ server để đồng bộ UI
      try {
        // reload main item
        const mainRes = await fetch(`/api/toc/item?toc_item_id=${tocItemId}`);
        if (mainRes.ok) {
          const j2 = (await mainRes.json()) as TocItemResponse;
          setData(j2);
          const html = parseContentJson(j2.content?.content_json);
          setRootHtml(html);
          setActiveSectionId("root");
        }

        // reload subsections
        const subsRes = await fetch(
          `/api/toc/subsections?parent_id=${tocItemId}`
        );
        const sj = await subsRes.json().catch(() => ({}));
        if (subsRes.ok && !sj.error) {
          const bareItems: SubItem[] = sj.items || [];
          const withContent: SubItemWithContent[] = await Promise.all(
            bareItems.map(async (s) => {
              try {
                const r = await fetch(`/api/toc/item?toc_item_id=${s.id}`);
                if (!r.ok) {
                  return { ...s, editorHtml: "<p></p>" };
                }
                const tj = (await r.json()) as TocItemResponse;
                const html = parseContentJson(
                  tj.content?.content_json
                );
                return { ...s, editorHtml: html };
              } catch {
                return { ...s, editorHtml: "<p></p>" };
              }
            })
          );
          withContent.sort((a, b) => a.order_index - b.order_index);
          setSubItems(withContent);
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

  const activeHtml = getActiveHtml();

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

      {/* Khu vực soạn thảo: sidebar mục con + editor */}
      <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-6">
        <div className="grid grid-cols-1 md:grid-cols-[260px,1fr] gap-6">
          {/* Sidebar: danh sách mục trong chương */}
          <aside className="space-y-3 border-b md:border-b-0 md:border-r border-gray-100 pb-4 md:pb-0 md:pr-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-800">
                Mục trong chương này
              </h3>
              {subLoading && (
                <span className="text-[11px] text-gray-400">
                  Đang tải...
                </span>
              )}
            </div>

            <div className="space-y-1 text-sm">
              <button
                type="button"
                className={`w-full text-left px-3 py-2 rounded-md border ${
                  activeSectionId === "root"
                    ? "border-blue-500 bg-blue-50 text-blue-800"
                    : "border-transparent hover:bg-gray-50 text-gray-700"
                }`}
                onClick={() => setActiveSectionId("root")}
              >
                <div className="text-xs uppercase tracking-wide text-gray-400">
                  Chương
                </div>
                <div className="font-medium">
                  {data.item.title}
                </div>
              </button>

              {subItems.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2"
                >
                  <button
                    type="button"
                    className={`flex-1 text-left px-3 py-2 rounded-md border ${
                      activeSectionId === s.id
                        ? "border-blue-500 bg-blue-50 text-blue-800"
                        : "border-transparent hover:bg-gray-50 text-gray-700"
                    }`}
                    onClick={() => setActiveSectionId(s.id)}
                  >
                    <div className="text-xs text-gray-400">
                      #{s.order_index}
                    </div>
                    <div className="font-medium">
                      {s.title}
                    </div>
                  </button>
                  {canManageSubsections && (
                    <button
                      className="text-[11px] text-red-500 hover:text-red-600 px-2 py-1"
                      onClick={() => handleDeleteSub(s.id)}
                    >
                      Xoá
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Thêm mục con mới */}
            {canManageSubsections && (
              <AddSubSectionForm
                onCreate={handleCreateSub}
              />
            )}
          </aside>

          {/* Editor cho section đang chọn */}
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold text-lg">
                  Nội dung: {getActiveTitle()}
                </h2>
                <p className="text-xs text-gray-500">
                  Bạn đang chỉnh sửa phần{" "}
                  {activeSectionId === "root"
                    ? "chương chính"
                    : "mục con"}
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

            {/* Toolbar đơn giản */}
            <div className="flex flex-wrap gap-2 text-sm border rounded-lg px-3 py-2 bg-gray-50">
              <button
                type="button"
                className="px-2 py-1 rounded hover:bg-gray-200 font-semibold"
                onClick={() =>
                  document.execCommand("bold", false)
                }
                disabled={!canEditContent}
              >
                B
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded hover:bg-gray-200 italic"
                onClick={() =>
                  document.execCommand("italic", false)
                }
                disabled={!canEditContent}
              >
                I
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded hover:bg-gray-200 underline"
                onClick={() =>
                  document.execCommand("underline", false)
                }
                disabled={!canEditContent}
              >
                U
              </button>
              <span className="h-6 w-px bg-gray-300 mx-1" />
              <button
                type="button"
                className="px-2 py-1 rounded hover:bg-gray-200"
                onClick={() =>
                  document.execCommand(
                    "insertUnorderedList",
                    false
                  )
                }
                disabled={!canEditContent}
              >
                • Bullet
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded hover:bg-gray-200"
                onClick={() =>
                  document.execCommand(
                    "insertOrderedList",
                    false
                  )
                }
                disabled={!canEditContent}
              >
                1.2.3
              </button>
              <span className="h-6 w-px bg-gray-300 mx-1" />
              <button
                type="button"
                className="px-2 py-1 rounded hover:bg-gray-200"
                onClick={() =>
                  document.execCommand(
                    "formatBlock",
                    false,
                    "<h2>"
                  )
                }
                disabled={!canEditContent}
              >
                H2
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded hover:bg-gray-200"
                onClick={() =>
                  document.execCommand(
                    "formatBlock",
                    false,
                    "<h3>"
                  )
                }
                disabled={!canEditContent}
              >
                H3
              </button>
            </div>

            {/* contentEditable */}
            <div
              className={`${INPUT} min-h-[280px] leading-relaxed text-sm whitespace-pre-wrap`}
              contentEditable={canEditContent}
              suppressContentEditableWarning
              onInput={(e) =>
                updateActiveHtml(e.currentTarget.innerHTML)
              }
              dangerouslySetInnerHTML={{ __html: activeHtml }}
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
                onClick={() => setActiveSectionId("root")}
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
          tất cả mục con bên trong chương này.
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

/** Form nhỏ để thêm mục con mới trong sidebar */
function AddSubSectionForm(props: {
  onCreate: (title: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || creating) return;
    setCreating(true);
    try {
      await props.onCreate(title.trim());
      setTitle("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-gray-100 pt-3 mt-2 space-y-2"
    >
      <label className="block text-xs font-medium text-gray-700">
        Thêm mục con mới
      </label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          className={INPUT}
          placeholder="Tiêu đề mục con (ví dụ: 1.1. Đại cương...)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button
          type="submit"
          className={BTN_PRIMARY}
          disabled={creating || !title.trim()}
        >
          {creating ? "Đang tạo..." : "Thêm mục con"}
        </button>
      </div>
    </form>
  );
}
