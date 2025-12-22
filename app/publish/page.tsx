// app/publish/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";

type Book = {
  id: string;
  title: string;
};

type Version = {
  id: string;
  version_no: number;
  status: string;
  created_at: string | null;
};

type Template = {
  id: string;
  name: string;
  description: string | null;
};

export default function PublishPage() {
  const { user, profile, loading: authLoading } = useAuth();

  const [books, setBooks] = useState<Book[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);

  const [selectedBookId, setSelectedBookId] = useState<string>("");
  const [selectedVersionId, setSelectedVersionId] = useState<string>("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [rendering, setRendering] = useState(false);
  const [exportingDocx, setExportingDocx] = useState(false); // mới
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  const [pdfFile, setPdfFile] = useState<File | null>(null);

  /** Load books + templates khi đã có user */
  useEffect(() => {
    if (!user) return;

    (async () => {
      setError("");
      // load books
      const { data: bookData, error: bookErr } = await supabase
        .from("books")
        .select("id,title")
        .order("created_at", { ascending: false });

      if (bookErr) {
        console.error("books error", bookErr);
        setError("Không tải được danh sách sách.");
      } else {
        setBooks(bookData || []);
      }

      // load templates
      const { data: tplData, error: tplErr } = await supabase
        .from("book_templates")
        .select("id,name,description")
        .eq("is_active", true)
        .order("name", { ascending: true });

      if (tplErr) {
        console.error("templates error", tplErr);
        setError((prev) => prev || "Không tải được danh sách template.");
      } else {
        setTemplates(tplData || []);
      }
    })();
  }, [user]);

  /** Khi chọn book -> load versions */
  useEffect(() => {
    if (!selectedBookId) {
      setVersions([]);
      setSelectedVersionId("");
      return;
    }

    (async () => {
      setError("");
      setVersions([]);
      setSelectedVersionId("");
      setPreviewUrl("");
      const res = await fetch(`/api/books/versions?book_id=${selectedBookId}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("versions error:", j?.error || res.status);
        setError("Không tải được danh sách phiên bản.");
        return;
      }
      const list = (j?.versions || []) as Version[];
      // sort version_no desc
      list.sort((a, b) => (b.version_no ?? 0) - (a.version_no ?? 0));
      setVersions(list);
    })();
  }, [selectedBookId]);

  /** Render PDF preview */
  async function handleRender() {
    setError("");
    setMessage("");
    setPreviewUrl("");

    if (!selectedVersionId || !selectedTemplateId) {
      setError("Hãy chọn đầy đủ Sách, Phiên bản và Template trước khi render.");
      return;
    }

    setRendering(true);
    try {
      const res = await fetch("/api/books/version/render-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version_id: selectedVersionId,
          template_id: selectedTemplateId,
        }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok || (j as any).error) {
        console.error("render error:", (j as any).error || res.status);
        setError(
          (j as any).error ||
            "Render PDF thất bại. Vui lòng kiểm tra lại nội dung và thử lại."
        );
        return;
      }

      if ((j as any).preview_url) {
        setPreviewUrl((j as any).preview_url);
        setMessage("Render thành công. Xem bản xem thử bên dưới.");
      } else {
        setMessage("Render thành công nhưng không có preview_url trả về.");
      }
    } catch (e: any) {
      console.error(e);
      setError("Lỗi kết nối khi gọi API render-pdf.");
    } finally {
      setRendering(false);
    }
  }

  /** Xuất Word (DOCX) dùng API render-docx */
  async function handleExportDocx() {
    setError("");
    setMessage("");

    if (!selectedVersionId || !selectedTemplateId) {
      setError("Hãy chọn đầy đủ Sách, Phiên bản và Template trước khi xuất Word.");
      return;
    }

    setExportingDocx(true);
    try {
      const res = await fetch("/api/books/version/render-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version_id: selectedVersionId,
          template_id: selectedTemplateId,
        }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        console.error("render-docx error:", (j as any).error || res.status);
        setError(
          (j as any).error ||
            "Xuất Word thất bại. Vui lòng kiểm tra lại nội dung và thử lại."
        );
        return;
      }

      const blob = await res.blob();
      // cố gắng lấy tên file từ header nếu có
      const disposition = res.headers.get("content-disposition") || "";
      let filename = "book.docx";
      const match = disposition.match(/filename="(.+?)"/i);
      if (match && match[1]) {
        filename = match[1];
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setMessage("Đã xuất file Word (DOCX). Vui lòng kiểm tra file tải xuống.");
    } catch (e: any) {
      console.error(e);
      setError("Lỗi kết nối khi gọi API render-docx.");
    } finally {
      setExportingDocx(false);
    }
  }

  /** Publish: upload file PDF final lên publish API */
  async function handlePublish() {
    setError("");
    setMessage("");

    if (!selectedVersionId) {
      setError("Hãy chọn phiên bản sách cần publish.");
      return;
    }

    if (!pdfFile) {
      setError("Hãy chọn file PDF hoàn chỉnh để publish.");
      return;
    }

    setPublishing(true);
    try {
      const fd = new FormData();
      fd.append("version_id", selectedVersionId);
      fd.append("pdf", pdfFile);

      const res = await fetch("/api/books/version/publish", {
        method: "POST",
        body: fd,
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok || (j as any).error) {
        console.error("publish error:", (j as any).error || res.status);
        setError(
          (j as any).error ||
            "Publish thất bại. Vui lòng kiểm tra file PDF và thử lại."
        );
        return;
      }

      setMessage(
        "Publish thành công. Bạn có thể ra trang Xem tài liệu để kiểm tra."
      );
    } catch (e: any) {
      console.error(e);
      setError("Lỗi kết nối khi gọi API publish.");
    } finally {
      setPublishing(false);
    }
  }

  if (authLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-10">
        <p className="text-gray-500">Đang tải...</p>
      </div>
    );
  }

  if (!user || profile?.system_role !== "admin") {
    return (
      <div className="max-w-4xl mx-auto px-4 py-10">
        <p className="text-red-600">
          Chỉ admin mới được truy cập chức năng dàn trang &amp; xuất bản.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Dàn trang &amp; Xuất bản</h1>
          <p className="text-gray-600 text-sm">
            Bước 1: chọn sách, phiên bản, template và bấm{" "}
            <b>Render PDF</b> để xem thử.
            <br />
            Bước 2: chọn file PDF hoàn chỉnh (nếu cần chỉnh sửa thêm) và bấm{" "}
            <b>Publish</b> để phát hành cho người xem.
          </p>
        </div>

        {/* Nút sang trang tạo template mới */}
        <Link
          href="/publish/templates/new"
          className="inline-flex items-center px-4 py-2 rounded-lg border border-blue-600 text-blue-600 text-sm font-semibold hover:bg-blue-50 whitespace-nowrap"
        >
          + Tạo template mới
        </Link>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          {message}
        </div>
      )}

      {/* Chọn sách / version / template */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Sách */}
        <div className="space-y-1">
          <label className="text-sm font-medium">Sách</label>
          <select
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={selectedBookId}
            onChange={(e) => setSelectedBookId(e.target.value)}
          >
            <option value="">-- Chọn sách --</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </div>

        {/* Phiên bản */}
        <div className="space-y-1">
          <label className="text-sm font-medium">Phiên bản</label>
          <select
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={selectedVersionId}
            onChange={(e) => setSelectedVersionId(e.target.value)}
            disabled={!versions.length}
          >
            <option value="">
              {versions.length ? "-- Chọn phiên bản --" : "Không có phiên bản"}
            </option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version_no} – {v.status}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500">
            Gợi ý: nên chọn phiên bản đã khóa nội dung trước khi render.
          </p>
        </div>

        {/* Template */}
        <div className="space-y-1">
          <label className="text-sm font-medium">Template sách</label>
          <select
            className="w-full border rounded-lg px-3 py-2 text-sm"
            value={selectedTemplateId}
            onChange={(e) => setSelectedTemplateId(e.target.value)}
          >
            <option value="">-- Chọn template --</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500">
            Template đang active trong bảng{" "}
            <code className="font-mono">book_templates</code>.
          </p>
        </div>
      </div>

      {/* Nút Render + Xuất Word */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleRender}
          disabled={rendering || !selectedVersionId || !selectedTemplateId}
          className="inline-flex items-center px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
        >
          {rendering ? "Đang render..." : "Render PDF xem thử"}
        </button>

        <button
          type="button"
          onClick={handleExportDocx}
          disabled={exportingDocx || !selectedVersionId || !selectedTemplateId}
          className="inline-flex items-center px-4 py-2 rounded-lg border border-indigo-600 text-indigo-600 text-sm font-semibold hover:bg-indigo-50 disabled:opacity-50"
        >
          {exportingDocx ? "Đang xuất Word..." : "Xuất Word (DOCX)"}
        </button>
      </div>

      {/* Upload & Publish */}
      <div className="mt-6 border-t pt-4 space-y-3">
        <h2 className="text-lg font-semibold">Publish bản chính thức</h2>
        <p className="text-sm text-gray-600">
          Chọn file PDF hoàn chỉnh (có thể là file vừa render, sau khi anh chỉnh
          lại bìa / metadata nếu cần) rồi bấm <b>Publish</b>.
        </p>

        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
            className="text-sm"
          />
          <button
            type="button"
            onClick={handlePublish}
            disabled={publishing || !selectedVersionId || !pdfFile}
            className="inline-flex items-center px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
          >
            {publishing ? "Đang publish..." : "Publish bản PDF này"}
          </button>
        </div>
      </div>

      {/* Preview iframe */}
      {previewUrl && (
        <div className="mt-6 border-t pt-4">
          <h2 className="text-lg font-semibold mb-2">Bản xem thử</h2>
          <p className="text-xs text-gray-500 mb-2">
            Đây là signed URL tạm thời từ bucket{" "}
            <code className="font-mono">pdf_previews</code>.
          </p>
          <div className="w-full aspect-[3/4] border rounded-lg overflow-hidden bg-gray-50">
            <iframe
              src={previewUrl}
              className="w-full h-full"
              title="PDF preview"
            />
          </div>
        </div>
      )}
    </div>
  );
}
