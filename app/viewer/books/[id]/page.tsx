"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

const BTN =
  "inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium hover:bg-gray-50";
const FRAME = "w-full h-[78vh] rounded-xl border bg-white";

export default function ViewerBookPage() {
  const params = useParams<{ id: string }>();
  const bookId = useMemo(() => params?.id ?? "", [params]);

  const [loading, setLoading] = useState(true);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    let alive = true;

    (async () => {
      if (!bookId) {
        if (alive) {
          setErr("Thiếu book id.");
          setLoading(false);
        }
        return;
      }

      setErr(null);
      setLoading(true);
      setPdfUrl(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!alive) return;

      setIsLoggedIn(!!user);

      const res = await fetch(
        `/api/viewer/pdf-url?book_id=${encodeURIComponent(bookId)}`,
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        }
      );

      const j = await res.json().catch(() => ({}));

      if (!alive) return;

      if (!res.ok) {
        setErr(j?.error || `HTTP ${res.status}`);
        setLoading(false);
        return;
      }

      if (!j?.url) {
        setErr("Không lấy được URL PDF.");
        setLoading(false);
        return;
      }

      setPdfUrl(j.url);
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [bookId]);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link className={BTN} href="/viewer">
            ← Thư viện
          </Link>
          <Link className={BTN} href="/books">
            Workspace
          </Link>
        </div>

        <div className="flex items-center gap-2">
          {isLoggedIn && (
            <a
              className={BTN}
              href={`/api/viewer/books/${encodeURIComponent(bookId)}/download`}
            >
              Tải PDF
            </a>
          )}

          {pdfUrl && (
            <a
              className={BTN}
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
            >
              Mở tab mới
            </a>
          )}
        </div>
      </div>

      {!isLoggedIn && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Bạn có thể xem tài liệu mà không cần đăng nhập. Chỉ người dùng đã đăng
          nhập mới được tải PDF.
        </div>
      )}

      {loading && <div className="text-sm text-gray-600">Đang tải PDF…</div>}
      {err && <div className="text-sm text-red-600">Lỗi: {err}</div>}

      {!loading && !err && pdfUrl && (
        <div
          className="select-none"
          onCopy={(e) => e.preventDefault()}
          onCut={(e) => e.preventDefault()}
          onContextMenu={(e) => e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
          style={{
            WebkitUserSelect: "none",
            userSelect: "none",
          }}
        >
          <iframe
            className={FRAME}
            src={`${pdfUrl}#toolbar=0&navpanes=0&scrollbar=1`}
            title="PDF Viewer"
          />
        </div>
      )}
    </div>
  );
}
