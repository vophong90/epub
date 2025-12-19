"use client";

import { useEffect, useMemo, useState } from "react";
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
  const [bodyText, setBodyText] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Load dữ liệu TOC item + content
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
          // Tạm coi content_json dạng { text: string }
          const text =
            typeof raw === "string"
              ? raw
              : raw?.text ??
                ""; // nếu sau này bạn đổi schema thì chỉnh chỗ này
          setBodyText(text);
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

  const status = (data?.content?.status ??
    "draft") as TocContent["status"];

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
    if (
      isAuthorRole &&
      isAssignedAuthor &&
      status !== "approved"
    ) {
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
      const text =
        typeof raw === "string" ? raw : raw?.text ?? "";
      setBodyText(text);
    } catch {
      // im lặng, giữ state cũ
    }
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
          content_json: { text: bodyText },
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
      // lưu trước
      await handleSave();
      // rồi submit
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
      const res = await fetch(
        "/api/toc/content/request-change",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toc_item_id: tocItemId }),
        }
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setErrorMsg(j.error || "Yêu cầu chỉnh sửa thất bại");
      } else {
        await reload();
      }
    } catch (e: any) {
      setErrorMsg(
        e?.message || "Lỗi khi gửi yêu cầu chỉnh sửa"
      );
    } finally {
      setRequestingChange(false);
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
          <button
            className={BTN}
            onClick={() => router.back()}
          >
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
            <Link
              href="/books"
              className="hover:underline"
            >
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
            <span className="text-gray-700">
              {data.item.title}
            </span>
          </div>
          <h1 className="text-2xl font-bold">
            {data.item.title}
          </h1>
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
          <button
            className={BTN}
            onClick={() => router.back()}
          >
            ← Quay lại sách
          </button>
        </div>
      </div>

      {/* Thông báo lỗi */}
      {errorMsg && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      {/* Editor nội dung */}
      <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">
            Nội dung mục này
          </h2>
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

        <textarea
          className={`${INPUT} min-h-[280px] font-mono text-sm`}
          value={bodyText}
          onChange={(e) => setBodyText(e.target.value)}
          readOnly={!canEditContent}
        />

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
              disabled
            >
              GPT kiểm tra nội dung (TODO)
            </button>
          </div>
        </div>
      </section>

      {/* Panel hành động của Editor */}
      {isEditor && (
        <section className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
          <h3 className="font-semibold text-sm text-slate-800">
            Hành động của Editor
          </h3>
          <p className="text-xs text-slate-600">
            Chỉ editor mới thấy phần này. Bạn có thể
            duyệt hoặc yêu cầu tác giả chỉnh sửa khi
            trạng thái đang là <strong>Đã nộp</strong>.
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
    </main>
  );
}
