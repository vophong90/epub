"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type BookInfo = {
  id: string;
  title: string | null;
  unit_name: string | null;
};

type VersionInfo = {
  id: string;
  version_no: number | null;
  status: string | null;
};

type Visibility = "public_open" | "internal_only";

type PubRow = {
  id: string;
  book_id: string;
  version_id: string;
  published_at: string | null;
  visibility: Visibility;
  books: BookInfo | BookInfo[] | null;
  book_versions: VersionInfo | VersionInfo[] | null;
};

const CARD = "rounded-xl border bg-white p-4 shadow-sm";
const BTN =
  "inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium hover:bg-gray-50";

function normalizeBookInfo(
  books: BookInfo | BookInfo[] | null | undefined
): BookInfo | null {
  if (!books) return null;
  if (Array.isArray(books)) return books[0] ?? null;
  return books;
}

function normalizeVersionInfo(
  version: VersionInfo | VersionInfo[] | null | undefined
): VersionInfo | null {
  if (!version) return null;
  if (Array.isArray(version)) return version[0] ?? null;
  return version;
}

function visibilityLabel(v: Visibility) {
  return v === "public_open" ? "Công khai" : "Nội bộ";
}

export default function ViewerHomePage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PubRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    let alive = true;

    (async () => {
      setErr(null);
      setLoading(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!alive) return;
      setIsLoggedIn(!!user);

      const { data, error } = await supabase
        .from("book_publications")
        .select(`
          id,
          book_id,
          version_id,
          visibility,
          published_at,
          books!inner (
            id,
            title,
            unit_name
          ),
          book_versions!inner (
            id,
            version_no,
            status
          )
        `)
        .eq("is_active", true)
        .order("published_at", { ascending: false });

      if (!alive) return;

      if (error) {
        setErr(error.message);
        setRows([]);
        setLoading(false);
        return;
      }

      setRows((data ?? []) as unknown as PubRow[]);
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Thư viện</h1>
          <div className="mt-1 text-sm text-gray-600">
            Sách công khai xem được ngay. Sách nội bộ cần đăng nhập để xem PDF.
          </div>
        </div>

        <div className="flex gap-2">
          <Link className={BTN} href="/books">
            Về workspace
          </Link>
          {!isLoggedIn && (
            <Link className={BTN} href="/login">
              Đăng nhập
            </Link>
          )}
        </div>
      </div>

      {loading && <div className="text-sm text-gray-600">Đang tải…</div>}
      {err && <div className="text-sm text-red-600">Lỗi: {err}</div>}

      {!loading && !err && rows.length === 0 && (
        <div className="text-sm text-gray-600">
          Chưa có sách nào được phát hành.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3">
        {rows.map((r) => {
          const book = normalizeBookInfo(r.books);
          const version = normalizeVersionInfo(r.book_versions);
          const canViewPdf =
            r.visibility === "public_open" || isLoggedIn;

          return (
            <div key={r.id} className={CARD}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold">
                    {book?.title || "(Không có tiêu đề)"}
                  </div>

                  <div className="mt-1 text-sm text-gray-600">
                    {book?.unit_name || "—"}
                    {" • "}
                    Phiên bản: {version?.version_no ?? "—"}
                    {" • "}
                    Loại: {visibilityLabel(r.visibility)}
                    {" • "}
                    Publish:{" "}
                    {r.published_at
                      ? new Date(r.published_at).toLocaleString()
                      : "—"}
                  </div>
                </div>

                <div className="flex gap-2">
                  {canViewPdf ? (
                    <Link className={BTN} href={`/viewer/books/${r.book_id}`}>
                      Xem PDF
                    </Link>
                  ) : (
                    <Link
                      className={`${BTN} text-gray-600`}
                      href="/login"
                      title="Đăng nhập để xem PDF nội bộ"
                    >
                      Đăng nhập để xem
                    </Link>
                  )}

                  {isLoggedIn ? (
                    <a
                      className={BTN}
                      href={`/api/viewer/books/${encodeURIComponent(
                        r.book_id
                      )}/download`}
                    >
                      Tải PDF
                    </a>
                  ) : (
                    <button
                      className={`${BTN} cursor-not-allowed opacity-50`}
                      disabled
                      title="Đăng nhập để tải PDF"
                    >
                      Tải PDF
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
