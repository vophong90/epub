"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
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
};

type Assignment = {
  id: string;
  toc_item_id: string;
  user_id: string;
  role_in_item: "author" | "editor";
};

type TocItemResponse = {
  item: TocItem;
  role: BookRole;
  book_id: string;
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
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [requestingChange, setRequestingChange] = useState(false);

  const [data, setData] = useState<TocItemResponse | null>(null);

  // Rich text state
  const [editorHtml, setEditorHtml] = useState("<p></p>");
  const editorRef = useRef<HTMLDivElement | null>(null);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Tab: soạn thảo / xem thử
  const [activeTab, setActiveTab] = useState<"edit" | "preview">("edit");

  // GPT check state
  const [checkingGPT, setCheckingGPT] = useState(false);
  const [gptResult, setGptResult] = useState<string | null>(null);
  const [gptError, setGptError] = useState<string | null>(null);

  // Sub-sections
  const [subLoading, setSubLoading] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);
  const [subItems, setSubItems] = useState<SubItem[]>([]);
  const [newSubTitle, setNewSubTitle] = useState("");
  const [creatingSub, setCreatingSub] = useState(false);
  const [deletingSubId, setDeletingSubId] = useState<string | null>(null);

  // Load TOC item + content
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
        } else {
          const j = (await res.json()) as TocItemResponse;
          setData(j);

          const raw = j.content?.content_json;
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
          setEditorHtml(html || "<p></p>");
          if (editorRef.current) {
            editorRef.current.innerHTML = html || "<p></p>";
          }
        }
      } catch (e: any) {
        setErrorMsg(e?.message || "Lỗi không xác định khi tải dữ liệu");
        setData(null);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [tocItemId]);

    // Load sub-sections
  useEffect(() => {
    if (!tocItemId) return;
    const loadSubs = async () => {
      setSubLoading(true);
      setSubError(null);
      try {
        const res = await fetch(
          `/api/toc/subsections?parent_id=${tocItemId}`
        );
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.error) {
          setSubError(j.error || `Lỗi tải mục con (${res.status})`);
          setSubItems([]);
        } else {
          setSubItems(j.items || []);
        }
      } catch (e: any) {
        setSubError(e?.message || "Lỗi khi tải mục con");
        setSubItems([]);
      } finally {
        setSubLoading(false);
      }
    };
    loadSubs();
  }, [tocItemId]);

  const status = (data?.content?.status ?? "draft") as TocContent["status"];

  const isEditor = data?.role === "editor";
  const isAuthorRole = data?.role === "author";

  const isAssignedAuthor = useMemo(() => {
    if (!user || !data) return false;
    return data.assignments.some(
      (a) => a.user_id === user.id && a.role_in_item === "author"
    );
  }, [data, user]);

  const canEditContent = useMemo(() => {
    if (!data) return false;
    if (isEditor) return true;
    if (isAuthorRole && isAssignedAuthor && status !== "approved") {
      return true;
    }
    return false;
  }, [data, isEditor, isAuthorRole, isAssignedAuthor, status]);

  const canSubmit =
    isAuthorRole &&
    isAssignedAuthor &&
    (status === "draft" || status === "needs_revision");

  const canApprove = isEditor && status === "submitted";
  const canRequestChange = isEditor && status === "submitted";

  const canManageSubsections =
    isEditor || (isAuthorRole && isAssignedAuthor);

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

  async function reload() {
    if (!tocItemId) return;
    try {
      const res = await fetch(`/api/toc/item?toc_item_id=${tocItemId}`);
      if (!res.ok) return;
      const j = (await res.json()) as TocItemResponse;
      setData(j);
      const raw = j.content?.content_json;
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
      setEditorHtml(html || "<p></p>");
      if (editorRef.current) {
        editorRef.current.innerHTML = html || "<p></p>";
      }
    } catch {
      // giữ state cũ
    }
  }

  async function reloadSubs() {
    if (!tocItemId) return;
    try {
      const res = await fetch(
        `/api/toc/subsections?parent_id=${tocItemId}`
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setSubError(j.error || `Lỗi tải mục con (${res.status})`);
        setSubItems([]);
      } else {
        setSubItems(j.items || []);
      }
    } catch (e: any) {
      setSubError(e?.message || "Lỗi khi tải mục con");
      setSubItems([]);
    }
  }

  // Rich text định dạng đơn giản
  function applyFormat(command: string, value?: string) {
    if (typeof window === "undefined") return;
    document.execCommand(command, false, value);
    if (editorRef.current) {
      setEditorHtml(editorRef.current.innerHTML);
    }
  }

  function stripHtml(html: string) {
    if (!html) return "";
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  // Lưu nội dung
  async function handleSave() {
    if (!tocItemId) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/toc/content/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toc_item_id: tocItemId,
          content_json: {
            type: "richtext",
            html: editorHtml,
          },
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setErrorMsg(j.error || "Lưu nội dung thất bại");
      } else {
        await reload();
      }
    } catch (e: any) {
      setErrorMsg(e?.message || "Lỗi khi lưu nội dung");
    } finally {
      setSaving(false);
    }
  }

  // Nộp cho editor
  async function handleSubmit() {
    if (!tocItemId) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await handleSave();
      const res = await fetch("/api/toc/content/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toc_item_id: tocItemId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setErrorMsg(j.error || "Nộp nội dung thất bại");
      } else {
        await reload();
      }
    } catch (e: any) {
      setErrorMsg(e?.message || "Lỗi khi nộp nội dung");
    } finally {
      setSubmitting(false);
    }
  }

  // Duyệt
  async function handleApprove() {
    if (!tocItemId) return;
    if (
      !window.confirm(
        "Duyệt nội dung này? Sau khi duyệt, tác giả sẽ không thể chỉnh sửa."
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
        await reload();
      }
    } catch (e: any) {
      setErrorMsg(e?.message || "Lỗi khi duyệt nội dung");
    } finally {
      setApproving(false);
    }
  }

  // Yêu cầu chỉnh sửa
  async function handleRequestChange() {
    if (!tocItemId) return;
    setRequestingChange(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/toc/content/request-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toc_item_id: tocItemId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setErrorMsg(j.error || "Yêu cầu chỉnh sửa thất bại");
      } else {
        await reload();
      }
    } catch (e: any) {
      setErrorMsg(e?.message || "Lỗi khi gửi yêu cầu chỉnh sửa");
    } finally {
      setRequestingChange(false);
    }
  }

  // GPT kiểm tra nội dung
  async function handleGPTCheck() {
    setCheckingGPT(true);
    setGptError(null);
    setGptResult(null);
    try {
      const plain = stripHtml(editorHtml);
      if (!plain) {
        setGptError("Không có nội dung để kiểm tra.");
        return;
      }
      const res = await fetch("/api/gpt/check-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: plain }),
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

  // Tạo sub-section
  async function handleCreateSub() {
    if (!tocItemId || !newSubTitle.trim()) return;
    setCreatingSub(true);
    setSubError(null);
    try {
      const res = await fetch("/api/toc/subsections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parent_id: tocItemId,
          title: newSubTitle.trim(),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setSubError(j.error || "Tạo mục con thất bại");
      } else {
        setNewSubTitle("");
        await reloadSubs();
      }
    } catch (e: any) {
      setSubError(e?.message || "Lỗi khi tạo mục con");
    } finally {
      setCreatingSub(false);
    }
  }

  // Xoá sub-section
  async function handleDeleteSub(id: string) {
    if (
      !window.confirm(
        "Xoá mục con này? Các mục con sâu hơn (nếu có) cũng sẽ bị xoá."
      )
    ) {
      return;
    }
    setDeletingSubId(id);
    setSubError(null);
    try {
      const res = await fetch(
        `/api/toc/subsections?id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setSubError(j.error || "Xoá mục con thất bại");
      } else {
        await reloadSubs();
      }
    } catch (e: any) {
      setSubError(e?.message || "Lỗi khi xoá mục con");
    } finally {
      setDeletingSubId(null);
    }
  }

  if (authLoading || loading) {
    return (
      <main className="max-w-5xl mx-auto px-4 py-8">
        <p className="text-gray-600">Đang tải...</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="max-w-5xl mx-auto px-4 py-8">
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
    <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* Breadcrumb + Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-sm text-gray-500">
            <Link href="/books" className="hover:underline">
              Sách của tôi
            </Link>
            <span className="mx-1">/</span>
            <Link
              href={`/books/${bookId}`}
              className="hover:underline"
            >
              Sách
            </Link>
            <span className="mx-1">/</span>
            <span className="text-gray-700">{data.item.title}</span>
          </div>
          <h1 className="text-2xl font-bold">{data.item.title}</h1>
          <div className="flex items-center gap-2 text-sm">
            <span className={statusChipClass(status)}>
              {statusLabel(status)}
            </span>
            {data.role && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
                Vai trò: {data.role}
              </span>
            )}
          </div>
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

      {/* Editor nội dung (rich text + preview) */}
      <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">Nội dung mục này</h2>
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

        {/* Tabs */}
        <div className="flex border-b border-gray-200 mb-2">
          <button
            type="button"
            className={`px-4 py-2 text-sm -mb-px border-b-2 ${
              activeTab === "edit"
                ? "border-blue-600 text-blue-700 font-semibold"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
            onClick={() => setActiveTab("edit")}
          >
            Soạn thảo
          </button>
          <button
            type="button"
            className={`px-4 py-2 text-sm -mb-px border-b-2 ${
              activeTab === "preview"
                ? "border-blue-600 text-blue-700 font-semibold"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
            onClick={() => setActiveTab("preview")}
          >
            Xem thử
          </button>
        </div>

        {activeTab === "edit" && (
          <>
            {/* Toolbar */}
            <div className="flex flex-wrap gap-2 text-sm border rounded-lg px-3 py-2 bg-gray-50">
              <button
                type="button"
                className="px-2 py-1 rounded hover:bg-gray-200 font-semibold"
                onClick={() => applyFormat("bold")}
                disabled={!canEditContent}
              >
                B
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded hover:bg-gray-200 italic"
                onClick={() => applyFormat("italic")}
                disabled={!canEditContent}
              >
                I
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded hover:bg-gray-200 underline"
                onClick={() => applyFormat("underline")}
                disabled={!canEditContent}
              >
                U
              </button>
              <span className="h-6 w-px bg-gray-300 mx-1" />
              <button
                type="button"
                className="px-2 py-1 rounded hover:bg-gray-200"
                onClick={() => applyFormat("insertUnorderedList")}
                disabled={!canEditContent}
              >
                • Bullet
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded hover:bg-gray-200"
                onClick={() => applyFormat("insertOrderedList")}
                disabled={!canEditContent}
              >
                1.2.3
              </button>
              <span className="h-6 w-px bg-gray-300 mx-1" />
              <button
                type="button"
                className="px-2 py-1 rounded hover:bg-gray-200"
                onClick={() => applyFormat("formatBlock", "<h2>")}
                disabled={!canEditContent}
              >
                H2
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded hover:bg-gray-200"
                onClick={() => applyFormat("formatBlock", "<h3>")}
                disabled={!canEditContent}
              >
                H3
              </button>
              <span className="h-6 w-px bg-gray-300 mx-1" />
              <button
                type="button"
                className="px-2 py-1 rounded hover:bg-gray-200 text-xs"
                onClick={() => {
                  if (!editorRef.current) return;
                  editorRef.current.innerHTML = "<p></p>";
                  setEditorHtml("<p></p>");
                }}
                disabled={!canEditContent}
              >
                Xoá định dạng
              </button>
            </div>

            {/* contentEditable */}
            <div
              ref={editorRef}
              className={`${INPUT} min-h-[280px] leading-relaxed text-sm whitespace-pre-wrap`}
              contentEditable={canEditContent}
              suppressContentEditableWarning
              onInput={(e) =>
                setEditorHtml(e.currentTarget.innerHTML)
              }
            />
          </>
        )}

        {activeTab === "preview" && (
          <div className="border rounded-lg px-4 py-4 bg-slate-50 max-h-[600px] overflow-auto">
            <article
              className="leading-relaxed text-[15px] text-slate-900 space-y-3"
              // Xem thử như HTML y khoa
              dangerouslySetInnerHTML={{ __html: editorHtml }}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              className={BTN_PRIMARY}
              onClick={handleSave}
              disabled={!canEditContent || saving}
            >
              {saving ? "Đang lưu..." : "Lưu bản nháp"}
            </button>

            <button
              className={BTN}
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
            >
              {submitting ? "Đang nộp..." : "Nộp cho editor"}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              className={BTN}
              onClick={handleGPTCheck}
              disabled={checkingGPT}
            >
              {checkingGPT
                ? "GPT đang kiểm tra..."
                : "GPT kiểm tra nội dung"}
            </button>
          </div>
        </div>

        {/* Kết quả GPT */}
        {(gptError || gptResult) && (
          <div className="mt-3 border-t pt-3 space-y-2">
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
      </section>

      {/* Panel hành động của Editor */}
      {isEditor && (
        <section className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
          <h3 className="font-semibold text-sm text-slate-800">
            Hành động của Editor
          </h3>
          <p className="text-xs text-slate-600">
            Chỉ editor mới thấy phần này. Bạn có thể duyệt hoặc yêu cầu
            tác giả chỉnh sửa khi trạng thái đang là{" "}
            <strong>Đã nộp</strong>.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className={BTN_PRIMARY}
              onClick={handleApprove}
              disabled={!canApprove || approving}
            >
              {approving ? "Đang duyệt..." : "Duyệt nội dung"}
            </button>
            <button
              className={BTN}
              onClick={handleRequestChange}
              disabled={!canRequestChange || requestingChange}
            >
              {requestingChange
                ? "Đang gửi yêu cầu..."
                : "Yêu cầu chỉnh sửa"}
            </button>
          </div>
        </section>
      )}

      {/* Panel phân công */}
      <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
        <h3 className="font-semibold text-sm text-gray-800">
          Thành viên được phân công
        </h3>
        {data.assignments.length === 0 ? (
          <p className="text-sm text-gray-500">
            Chưa có ai được phân công cho mục này.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.assignments.map((a) => {
              const isMe = user && a.user_id === user.id;
              return (
                <li
                  key={a.id}
                  className="flex items-center gap-2"
                >
                  <span className="font-medium">
                    {a.user_id}
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
        <p className="text-xs text-gray-400">
          (TODO: map user_id → tên từ profiles nếu cần)
        </p>
      </section>

      {/* Panel mục con */}
      <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-sm text-gray-800">
              Mục con trong mục này
            </h3>
            <p className="text-xs text-gray-500">
              Tác giả được phân công có thể tạo thêm mục nhỏ bên trong
              phần mình phụ trách.
            </p>
          </div>
          {subLoading && (
            <span className="text-xs text-gray-400">
              Đang tải mục con...
            </span>
          )}
        </div>

        {subError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {subError}
          </div>
        )}

        {subItems.length === 0 && !subLoading ? (
          <p className="text-sm text-gray-500">
            Chưa có mục con nào cho mục này.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {subItems.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 border rounded-md px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-8">
                    #{s.order_index}
                  </span>
                  <Link
                    href={`/books/${bookId}/toc/${s.id}`}
                    className="font-medium text-blue-700 hover:underline"
                  >
                    {s.title}
                  </Link>
                </div>
                {canManageSubsections && (
                  <button
                    className="text-xs text-red-600 hover:text-red-700"
                    onClick={() => handleDeleteSub(s.id)}
                    disabled={deletingSubId === s.id}
                  >
                    {deletingSubId === s.id ? "Đang xoá..." : "Xoá"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canManageSubsections && (
          <div className="border-t border-gray-100 pt-3 mt-2 space-y-2">
            <label className="block text-xs font-medium text-gray-700">
              Thêm mục con mới
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                className={INPUT}
                placeholder="Tiêu đề mục con (ví dụ: 1.1. Đại cương...)"
                value={newSubTitle}
                onChange={(e) => setNewSubTitle(e.target.value)}
              />
              <button
                className={BTN_PRIMARY}
                onClick={handleCreateSub}
                disabled={creatingSub || !newSubTitle.trim()}
              >
                {creatingSub ? "Đang tạo..." : "Thêm mục con"}
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
