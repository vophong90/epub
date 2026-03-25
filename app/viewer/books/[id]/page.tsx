"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getDocument, GlobalWorkerOptions, version } from "pdfjs-dist";

GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;

const BTN =
  "inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium hover:bg-gray-50";
const CARD = "rounded-xl border bg-white shadow-sm";

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

function PageCanvas({
  pdf,
  pageNumber,
  width,
  scaleBoost,
  isMobile,
}: {
  pdf: any;
  pageNumber: number;
  width: number;
  scaleBoost: number;
  isMobile: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setIsVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: "500px" }
    );

    obs.observe(canvas);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function renderPage() {
      if (!pdf || !canvasRef.current || !width || !isVisible) return;

      setLoading(true);
      setErr(null);

      try {
        const page = await pdf.getPage(pageNumber);
        const unscaledViewport = page.getViewport({ scale: 1 });

        // Sửa để mobile fit theo chiều ngang container, không ép rộng hơn màn hình
        const horizontalPadding = isMobile ? 8 : 0;
        const targetWidth = Math.max(280, width - horizontalPadding);
        const fitScale = targetWidth / unscaledViewport.width;
        const scale = fitScale * scaleBoost;

        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current!;
        const context = canvas.getContext("2d");

        if (!context) throw new Error("Không tạo được canvas context");

        const outputScale = Math.min(window.devicePixelRatio || 1, 2);

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        context.setTransform(outputScale, 0, 0, outputScale, 0, 0);

        const renderTask = page.render({
          canvasContext: context,
          viewport,
        });

        await renderTask.promise;

        if (!cancelled) setLoading(false);
      } catch (e: any) {
        if (!cancelled) {
          setErr(e?.message || "Render trang thất bại");
          setLoading(false);
        }
      }
    }

    renderPage();

    return () => {
      cancelled = true;
    };
  }, [pdf, pageNumber, width, scaleBoost, isVisible, isMobile]);

  return (
    <div className="mb-6">
      <div className="mb-2 text-center text-sm text-gray-500">Trang {pageNumber}</div>

      {loading && (
        <div className="mb-2 text-center text-sm text-gray-500">
          Đang tải trang {pageNumber}…
        </div>
      )}

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      <div className="overflow-x-hidden">
        <div className="flex justify-center">
          <canvas
            ref={canvasRef}
            className="rounded-lg border bg-white shadow-sm max-w-full"
            onContextMenu={(e) => e.preventDefault()}
            onDragStart={(e) => e.preventDefault()}
            style={{
              userSelect: "none",
              WebkitUserSelect: "none",
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default function ViewerBookPage() {
  const params = useParams<{ id: string }>();
  const bookId = useMemo(() => params?.id ?? "", [params]);

  const containerRef = useRef<HTMLDivElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pdf, setPdf] = useState<any>(null);
  const [numPages, setNumPages] = useState(0);
  const [width, setWidth] = useState(900);
  const [visibility, setVisibility] = useState<Visibility | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Mobile mặc định 100% để fit màn hình tốt hơn
  const [scaleBoost, setScaleBoost] = useState(1.0);

  // Mobile chỉ render một phần trước để tránh quá tải
  const [visiblePages, setVisiblePages] = useState(12);

  useEffect(() => {
    const mobile = isMobileDevice();
    setIsMobile(mobile);
    setScaleBoost(mobile ? 1.0 : 1.0);
    setVisiblePages(mobile ? 8 : 20);
  }, []);

  useEffect(() => {
    function updateWidth() {
      const el = containerRef.current;
      if (!el) return;
      const next = Math.max(320, Math.floor(el.clientWidth - 24));
      setWidth(next);
    }

    updateWidth();

    const ro = new ResizeObserver(() => updateWidth());
    if (containerRef.current) ro.observe(containerRef.current);

    window.addEventListener("resize", updateWidth);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateWidth);
    };
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        if (!bookId) {
          if (alive) {
            setErr("Thiếu book id.");
            setLoading(false);
          }
          return;
        }

        setLoading(true);
        setErr(null);
        setPdf(null);
        setNumPages(0);

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
          setErr(j?.error || `HTTP ${res.status}`);
          setLoading(false);
          return;
        }

        if (!j?.url) {
          setErr("Không lấy được URL PDF.");
          setLoading(false);
          return;
        }

        const task = getDocument({
          url: j.url,
          withCredentials: false,
          disableAutoFetch: true,
          disableStream: true,
          disableRange: true,
          useWorkerFetch: false,
          isEvalSupported: false,
        });

        const loadedPdf = await task.promise;

        if (!alive) {
          try {
            await loadedPdf.destroy();
          } catch {}
          return;
        }

        setPdf(loadedPdf);
        setNumPages(loadedPdf.numPages || 0);
        setLoading(false);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Không mở được tài liệu.");
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [bookId]);

  const zoomOut = () =>
    setScaleBoost((s) => Math.max(0.2, +(s - 0.1).toFixed(2)));

  const zoomIn = () =>
    setScaleBoost((s) => Math.min(1.8, +(s + 0.1).toFixed(2)));

  const pagesToRender = Math.min(visiblePages, numPages);

  return (
    <div className="mx-auto max-w-6xl p-3 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link className={BTN} href="/viewer">
            ← Thư viện
          </Link>
          <Link className={BTN} href="/books">
            Workspace
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BTN} onClick={zoomOut}>
            A-
          </button>
          <button type="button" className={BTN} onClick={zoomIn}>
            A+
          </button>

          {isLoggedIn && (
            <a
              className={BTN}
              href={`/api/viewer/books/${encodeURIComponent(bookId)}/download`}
            >
              Tải PDF
            </a>
          )}
        </div>
      </div>

      {!isLoggedIn && visibility === "public_open" && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Đây là tài liệu công khai. Bạn có thể xem trực tiếp trên web. Muốn tải PDF
          cần đăng nhập.
        </div>
      )}

      {!isLoggedIn && visibility === "internal_only" && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          Đây là tài liệu nội bộ. Bạn cần đăng nhập để xem tài liệu.
        </div>
      )}

      <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
        Trên thiết bị di động, hệ thống chỉ tải một phần trang, bạn có thể bấm “Xem thêm trang” để xem đầy đủ nội dung.
      </div>

      {loading && (
        <div className={`${CARD} px-4 py-6 text-sm text-gray-600`}>
          Đang tải tài liệu…
        </div>
      )}

      {err && (
        <div className={`${CARD} border-red-200 bg-red-50 px-4 py-6 text-sm text-red-700`}>
          Lỗi: {err}
        </div>
      )}

      {!loading && !err && pdf && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white px-4 py-3 text-sm text-gray-700 shadow-sm">
            <div>
              Tổng số trang: <b>{numPages}</b>
            </div>
            <div>
              Đang hiển thị: <b>{pagesToRender}</b> / {numPages} trang
            </div>
            <div>
              Tỷ lệ hiển thị: <b>{Math.round(scaleBoost * 100)}%</b>
            </div>
          </div>

          <div ref={containerRef} className={`${CARD} overflow-hidden p-3 md:p-6`}>
            {Array.from({ length: pagesToRender }, (_, i) => i + 1).map((pageNumber) => (
              <PageCanvas
                key={pageNumber}
                pdf={pdf}
                pageNumber={pageNumber}
                width={width}
                scaleBoost={scaleBoost}
                isMobile={isMobile}
              />
            ))}

            {pagesToRender < numPages && (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  className={BTN}
                  onClick={() =>
                    setVisiblePages((n) => Math.min(n + (isMobile ? 6 : 12), numPages))
                  }
                >
                  Xem thêm trang
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
