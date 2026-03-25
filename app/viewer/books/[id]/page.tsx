"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

const BTN =
  "inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium hover:bg-gray-50";
const FRAME = "w-full h-[78vh] rounded-xl border bg-white";

type Visibility = "public_open" | "internal_only";

type PdfUrlResponse = {
  url?: string;
  visibility?: Visibility;
  error?: string;
};

function isMobileDevice() {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(ua);
}

export default function ViewerBookPage() {
  const params = useParams<{ id: string }>();
  const bookId = useMemo(() => params?.id ?? "", [params]);

  const [loading, setLoading] = useState(true);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [visibility, setVisibility] = useState<Visibility | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [enablePreview, setEnablePreview] = useState(false);

  useEffect(() => {
    setIsMobile(isMobileDevice());
  }, []);

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
      setEnablePreview(false);

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

      const j: PdfUrlResponse = await res.json().catch(() => ({}));

      if (!alive) return;

      if (j?.visibility) setVisibility(j.visibility);

      if (!res.ok) {
        const apiError = j?.error || `HTTP ${res.status}`;

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

  const canShowDesktopPreview = !!pdfUrl && enablePreview && !isMobile;

  const openMobileViewer = () => {
    if (!pdfUrl) return;
    window.location.href = pdfUrl;
  };

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

        <div className="flex flex-wrap items-center gap-2">
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

          {!!pdfUrl && !isMobile && !enablePreview && (
            <button
              type="button"
              className={BTN}
              onClick={() => setEnablePreview(true)}
            >
              Bật xem trước
            </button>
          )}

          {!!pdfUrl && !isMobile && enablePreview && (
            <button
              type="button"
              className={BTN}
              onClick={() => setEnablePreview(false)}
            >
              Tắt xem trước
            </button>
          )}

          {!!pdfUrl && isMobile && (
            <button
              type="button"
              className={BTN}
              onClick={openMobileViewer}
            >
              Xem trên mobile
            </button>
          )}
        </div>
      </div>

      {!isLoggedIn && visibility === "public_open" && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Đây là tài liệu công khai. Bạn có thể xem mà không cần đăng nhập. Muốn
          tải PDF thì cần đăng nhập.
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

      {isMobile && pdfUrl && (
        <div className="mb-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
          Trên mobile, hệ thống sẽ không tự mở PDF để tránh tự tải file khi vừa
          vào trang. Hãy bấm <b>Xem trên mobile</b> khi bạn thật sự muốn mở tài liệu.
        </div>
      )}

      {loading && <div className="text-sm text-gray-600">Đang tải PDF…</div>}
      {err && <div className="text-sm text-red-600">Lỗi: {err}</div>}

      {!loading && !err && pdfUrl && !isMobile && !enablePreview && (
        <div className="rounded-xl border border-dashed bg-gray-50 p-6 text-sm text-gray-700">
          PDF đã sẵn sàng. Bấm <b>Bật xem trước</b> để mở trực tiếp trong trang.
        </div>
      )}

      {!loading && !err && canShowDesktopPreview && (
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
