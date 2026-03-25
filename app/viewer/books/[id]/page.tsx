"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

const BTN =
  "inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium hover:bg-gray-50";
const FRAME = "w-full h-[78vh] rounded-xl border bg-white";

type PdfUrlResponse = {
  url?: string;
  visibility?: "public_open" | "internal_only";
  error?: string;
};

export default function ViewerBookPage() {
  const params = useParams<{ id: string }>();
  const bookId = useMemo(() => params?.id ?? "", [params]);

  const [loading, setLoading] = useState(true);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [visibility, setVisibility] = useState<"public_open" | "internal_only" | null>(null);

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
      setVisibility(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!alive) return;

      const loggedIn = !!user;
      setIsLoggedIn(loggedIn);

      const res = await fetch(
        `/api/viewer/pdf-url?book_id=${encodeURIComponent(bookId)}`,
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        }
      );

      const j: PdfUrlResponse = await res.json().catch(() => ({}));

      if (!alive) return;

      if (j?.visibility) {
        setVisibility(j.visibility);
      }

      if (!res.ok) {
        const apiError = j?.error || `HTTP ${res.status}`;

        // Trường hợp sách nội bộ mà chưa đăng nhập
        if (
          res.status === 401 ||
          res.status === 403 ||
          /đăng nhập|login|unauthorized|forbidden/i.test(apiError)
        ) {
          setErr("Tài liệu này thuộc phạm vi nội bộ. Bạn cần đăng nhập để xem PDF.");
        } else {
          setErr(apiError);
        }

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

  const needsLoginToView =
    !isLoggedIn && visibility === "internal_only" && !pdfUrl;

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

          {needsLoginToView && (
            <Link className={BTN} href="/login">
              Đăng nhập để xem
            </Link>
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

      {!isLoggedIn && visibility === "public_open" && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Đây là tài liệu công khai. Bạn có thể xem mà không cần đăng nhập. Muốn tải PDF thì cần đăng nhập.
        </div>
      )}

      {!isLoggedIn && visibility === "internal_only" && !pdfUrl && (
        <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          Đây là tài liệu nội bộ. Bạn cần đăng nhập để xem PDF.
        </div>
      )}

      {isLoggedIn && visibility === "internal_only" && (
        <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          Bạn đang xem tài liệu nội bộ.
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
