// app/books/[id]/toc/[tocItemId]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";

import { TocEditor } from "@/components/toc/TocEditor";
import { TocImportPanel } from "@/components/toc/TocImportPanel";
import { TocEditorActions } from "@/components/toc/TocEditorActions";
import { TocTreeSidebar } from "@/components/toc/TocTreeSidebar";

/** COMMON UI CLASSES */
const INPUT =
  "w-full border rounded-lg px-3 py-2 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-200";
const BTN =
  "inline-flex items-center justify-center px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed";
const BTN_PRIMARY =
  "inline-flex items-center justify-center px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed";
const CHIP =
  "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold";

/** TYPES */
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

export default function TocItemPage() {
  const params = useParams<{ id: string; tocItemId: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const bookId = params.id;
  const tocItemId = params.tocItemId;

  /** STATE */
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
  const [activeSectionId, setActiveSectionId] =
    useState<"root" | string>("root");

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

  // author được phân công?
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

  const canManageSubsections = isEditor || (isAuthorRole && isAssignedAuthor);

  const canResolveNote =
    isAuthorRole &&
    isAssignedAuthor &&
    contentStatus === "needs_revision" &&
    !!data?.content?.editor_note &&
    !editorNoteResolved;

  /** HELPERS */
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

  // sync editorNote
  useEffect(() => {
    setEditorNote(data?.content?.editor_note ?? "");
  }, [data?.content?.editor_note]);

  /** LOAD MAIN ITEM */
  async function loadMain(tid: string) {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/toc/item?toc_item_id=${tid}`);
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
  }

  /** LOAD SUB-ITEMS */
  async function loadSubs(tid: string) {
    setSubLoading(true);
    try {
      const res = await fetch(`/api/toc/subsections?parent_id=${tid}`);
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
            const html = parseContentJson(tj.content?.content_json);
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
  }

  async function reloadAll() {
    if (!tocItemId) return;
    await Promise.all([loadMain(tocItemId), loadSubs(tocItemId)]);
  }

  // init load
  useEffect(() => {
    if (!tocItemId) return;
    loadMain(tocItemId);
    loadSubs(tocItemId);
  }, [tocItemId]);

  /** HTML helpers */
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

  /** SAVE CONTENT */
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

  /** SUBMIT / APPROVE / REQUEST CHANGE / RESOLVE NOTE */
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
        await loadMain(tocItemId);
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
        await loadMain(tocItemId);
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
        await loadMain(tocItemId);
      }
    } catch (e: any) {
      setErrorMsg(e?.message || "Lỗi khi yêu cầu chỉnh sửa");
    } finally {
      setRequestingChange(false);
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
        await loadMain(tocItemId);
      }
    } catch (e: any) {
      setErrorMsg(e?.message || "Lỗi khi đánh dấu đã giải quyết");
    } finally {
      setResolvingNote(false);
    }
  }

  /** GPT CHECK */
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

  /** SUB-ITEM: CREATE / DELETE / RENAME */
  async function handleCreateSub(title: string) {
    if (!tocItemId || !title.trim()) return;
    setSubLoading(true);
    setErrorMsg(null);
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
          [...prev, s].sort((a, b) => a.order_index - b.order_index)
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
        setSubItems((prev) => prev.filter((s) => s.id !== id));
        if (activeSectionId === id) {
          setActiveSectionId("root");
        }
      }
    } catch (e: any) {
      setErrorMsg(e?.message || "Lỗi khi xoá mục con");
    }
  }

  async function handleRenameSub(id: string, newTitle: string) {
    const title = newTitle.trim();
    if (!title) {
      setErrorMsg("Tiêu đề mục con không được để trống.");
      return;
    }
    setErrorMsg(null);
    try {
      const res = await fetch("/api/toc/subsections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, title }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setErrorMsg(j.error || "Sửa tiêu đề mục con thất bại");
        return;
      }
      const updated = j.item as SubItem;
      setSubItems((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, title: updated.title } : s
        )
      );
    } catch (e: any) {
      setErrorMsg(e?.message || "Lỗi khi sửa mục con");
    }
  }

  /** RENDER STATES */
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
        {errorMsg && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {errorMsg}
          </div>
        )}
        <p className="text-gray-600">Không tìm thấy nội dung cho mục này.</p>
        <div className="mt-4">
          <button className={BTN} onClick={() => router.back()}>
            ← Quay lại
          </button>
        </div>
      </main>
    );
  }

  const canImport = canEditContent && canManageSubsections;

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
            <Link href={`/books/${bookId}`} className="hover:underline">
              {data.book_title || "Sách"}
            </Link>
            <span className="mx-1">/</span>
            <span className="text-gray-700">{data.item.title}</span>
          </div>
          <h1 className="text-2xl font-bold">{data.item.title}</h1>

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
                  const label = a.profile?.name || a.profile?.email || a.user_id;
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
                        {a.role_in_item === "author" ? "Author" : "Editor"}
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
              {new Date(data.content.updated_at).toLocaleString()}
            </div>
          )}
          <button className={BTN} onClick={() => router.back()}>
            ← Quay lại sách
          </button>
        </div>
      </div>

      {/* Error chung */}
      {errorMsg && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      {/* Ghi chú editor */}
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

        {isEditor ? (
          <div className="space-y-2">
            <p className="text-xs text-gray-500">
              Ghi chú này sẽ gửi cho tác giả khi bạn bấm{" "}
              <strong>“Yêu cầu chỉnh sửa chương”</strong>.
            </p>
            <textarea
              className={`${INPUT} text-sm min-h-[100px]`}
              placeholder="Ví dụ: Cần bổ sung thêm tài liệu tham khảo ở mục 1.2..."
              value={editorNote}
              onChange={(e) => setEditorNote(e.target.value)}
            />
          </div>
        ) : (
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

      {/* Khu vực soạn thảo: Sidebar + Editor */}
      <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-6">
        <div className="grid grid-cols-1 md:grid-cols-[260px,1fr] gap-6">
          {/* Sidebar dùng TocTreeSidebar */}
          <TocTreeSidebar
            chapterTitle={data.item.title}
            items={subItems.map((s) => ({
              id: s.id,
              title: s.title,
              order_index: s.order_index,
            }))}
            activeSectionId={activeSectionId}
            canManageSubsections={canManageSubsections}
            loading={subLoading}
            onSelectSection={setActiveSectionId}
            onCreateSub={handleCreateSub}
            onDeleteSub={handleDeleteSub}
            onRenameSub={handleRenameSub}
          />

          {/* Editor section */}
          <div className="space-y-4">
            <TocEditor
              value={getActiveHtml()}
              canEdit={canEditContent}
              sectionTitle={getActiveTitle()}
              sectionKindLabel={
                activeSectionId === "root" ? "chương chính" : "mục con"
              }
              onChange={updateActiveHtml}
            />

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

      {/* Hành động cho cả chương */}
      <section className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
        <h3 className="font-semibold text-sm text-slate-800">
          Hành động cho cả chương
        </h3>
        <p className="text-xs text-slate-600">
          Các nút bên dưới áp dụng cho chương hiện tại và tất cả mục con bên
          trong chương này.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            className={BTN_PRIMARY}
            onClick={handleSaveAll}
            disabled={!canEditContent || savingAll}
          >
            {savingAll ? "Đang lưu cả chương..." : "Lưu bản nháp chương"}
          </button>

          <button
            className={BTN}
            onClick={handleSubmitChapter}
            disabled={!canSubmit || submitting}
          >
            {submitting ? "Đang nộp chương..." : "Nộp chương cho editor"}
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

        {/* Import từ Word */}
        <TocImportPanel
          tocItemId={tocItemId}
          canImport={canImport}
          onImportedSuccessfully={reloadAll}
        />
      </section>

      {/* Panel hành động của Editor */}
      {isEditor && (
        <TocEditorActions
          canApprove={canApprove}
          canRequestChange={canRequestChange}
          approving={approving}
          requestingChange={requestingChange}
          onApprove={handleApproveChapter}
          onRequestChange={handleRequestChangeChapter}
        />
      )}
    </main>
  );
}
