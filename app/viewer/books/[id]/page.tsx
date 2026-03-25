"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

const BTN =
  "inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium hover:bg-gray-50";
const IMG_CLASS = "w-full rounded-lg border bg-white shadow-sm";

type Visibility = "public_open" | "internal_only";

type PagesResponse = {
  book_id?: string;
  page_count?: number;
  pages?: { page: number; url: string | null; path: string }[];
  error?: string;
};

type PdfUrlResponse = {
  visibility?: Visibility;
  error?: string;
};

export default function ViewerBookPage() {
  const params = useParams<{ id: string }>();
  const bookId = useMemo(() => params?.id ?? "", [params]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pages, setPages] = useState<{ page: number; url: string | null }[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [visibility, setVisibility] = useState<Visibility | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

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
        setPages([]);
        setPageCount(0);

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!alive) return;
        setIsLoggedIn(!!user);

        // Lấy visibility để hiển thị trạng thái
        const metaRes = await fetch(
          `/api/viewer/pdf-url?book_id=${encodeURIComponent(bookId)}`,
          {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          }
        );

        const metaJson: PdfUrlResponse = await metaRes.json().catch(() => ({}));
        if (!alive) return;

        if (metaJson?.visibility) setVisibility(metaJson.visibility);

        // Lấy preview pages
        const pagesRes = await fetch(
          `/api/viewer/books/${encodeURIComponent(bookId)}/pages`,
          {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          }
        );

        const pagesJson: PagesResponse = await pagesRes.json().catch(() => ({}));
        if (!alive) return;

        if (!pagesRes.ok) {
          setErr(pagesJson?.error || `HTTP ${pagesRes.status}`);
          setLoading(false);
          return;
        }

        setPages((pagesJson.pages || []).map((p) => ({ page: p.page, url: p.url })));
        setPageCount(Number(pagesJson.page_count || 0));
        setLoading(false);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Lỗi không xác định");
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [bookId]);

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
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
          Đây là tài liệu công khai. Bạn có thể xem trực tiếp. Muốn tải PDF gốc thì cần đăng nhập.
        </div>
      )}

      {isLoggedIn && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          Bạn đang đăng nhập. Có thể xem preview và tải PDF gốc nếu được cấp quyền.
        </div>
      )}

      <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
        Chế độ xem hiện tại là preview ảnh từng trang để tránh trình duyệt tự mở hoặc tự tải PDF trên mobile.
      </div>

      {loading && <div className="text-sm text-gray-600">Đang tải tài liệu…</div>}
      {err && <div className="text-sm text-red-600">Lỗi: {err}</div>}

      {!loading && !err && (
        <>
          <div className="mb-4 text-sm text-gray-600">
            Tổng số trang: <b>{pageCount}</b>
          </div>

          <div className="space-y-5">
            {pages.map((p) => (
              <div key={p.page} className="space-y-2">
                <div className="text-center text-sm text-gray-500">Trang {p.page}</div>
                {p.url ? (
                  <img
                    src={p.url}
                    alt={`Trang ${p.page}`}
                    className={IMG_CLASS}
                    loading="lazy"
                    draggable={false}
                    onContextMenu={(e) => e.preventDefault()}
                    onDragStart={(e) => e.preventDefault()}
                    style={{ userSelect: "none", WebkitUserSelect: "none" }}
                  />
                ) : (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    Không tải được preview của trang {p.page}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
