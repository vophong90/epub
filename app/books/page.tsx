// app/books/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";

type Book = {
  id: string;
  title: string;
  created_at: string | null;
  unit_name: string | null;
};

const INPUT =
  "w-full border rounded-lg px-3 py-2 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-200";
const BTN =
  "inline-flex items-center justify-center px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-50";
const BTN_PRIMARY =
  "inline-flex items-center justify-center px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50";

function toISOStartOfDay(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toISOString();
}
function toISOEndOfDay(dateStr: string) {
  const d = new Date(`${dateStr}T23:59:59`);
  return d.toISOString();
}

export default function BooksPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string>("");

  // Filters
  const [q, setQ] = useState("");
  const [dateFrom, setDateFrom] = useState(""); // YYYY-MM-DD
  const [dateTo, setDateTo] = useState(""); // YYYY-MM-DD
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  // chống race condition / response cũ
  const reqIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ✅ Guard auth: chưa login thì về /login (chỉ chạy khi authLoading đã xong)
  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  async function loadBooks() {
    const myReqId = ++reqIdRef.current;

    setErrMsg("");
    setLoading(true);

    try {
      if (authLoading) return;
      if (!user) {
        router.replace("/login");
        return;
      }

      let queryBuilder = supabase
        .from("books")
        .select("id,title,created_at,unit_name")
        .order("created_at", { ascending: sortDir === "asc" });

      const qTrim = q.trim();
      if (qTrim) queryBuilder = queryBuilder.ilike("title", `%${qTrim}%`);
      if (dateFrom) queryBuilder = queryBuilder.gte("created_at", toISOStartOfDay(dateFrom));
      if (dateTo) queryBuilder = queryBuilder.lte("created_at", toISOEndOfDay(dateTo));

      // 👇 Chờ trực tiếp supabase query, không dùng withTimeout nữa
      const { data, error } = await queryBuilder;

      if (error) throw error;
      if (!mountedRef.current || myReqId !== reqIdRef.current) return;

      setBooks((data || []) as Book[]);
    } catch (e: any) {
      console.error("loadBooks FAILED:", e);
      if (!mountedRef.current || myReqId !== reqIdRef.current) return;

      setBooks([]);
      setErrMsg(e?.message ? String(e.message) : "Không tải được danh sách sách.");
    } finally {
      if (!mountedRef.current || myReqId !== reqIdRef.current) return;
      setLoading(false);
    }
  }

  // ✅ Load lần đầu khi auth đã sẵn sàng + khi đổi sort
  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    loadBooks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, sortDir]);

  const qHint = useMemo(() => {
    const parts: string[] = [];
    if (q.trim()) parts.push(`tên chứa "${q.trim()}"`);
    if (dateFrom) parts.push(`từ ${dateFrom}`);
    if (dateTo) parts.push(`đến ${dateTo}`);
    return parts.length ? parts.join(", ") : "không lọc";
  }, [q, dateFrom, dateTo]);

  if (authLoading) return <div className="max-w-4xl mx-auto px-4 py-6">Đang xác thực...</div>;
  if (!user) return null;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold">Sách của tôi</h1>
      </div>

      {/* Filters */}
      <div className="border rounded-xl p-4 bg-white mb-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <label className="text-sm text-gray-600">Tìm theo tên sách</label>
            <input
              className={INPUT}
              placeholder="Nhập tên sách..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm text-gray-600">Từ ngày tạo</label>
            <input className={INPUT} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>

          <div>
            <label className="text-sm text-gray-600">Đến ngày tạo</label>
            <input className={INPUT} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mt-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Sắp xếp:</span>
            <button className={BTN} onClick={() => setSortDir("desc")} disabled={sortDir === "desc"}>
              Mới → Cũ
            </button>
            <button className={BTN} onClick={() => setSortDir("asc")} disabled={sortDir === "asc"}>
              Cũ → Mới
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              className={BTN}
              onClick={() => {
                setQ("");
                setDateFrom("");
                setDateTo("");
              }}
            >
              Xoá lọc
            </button>

            <button className={BTN_PRIMARY} onClick={loadBooks}>
              Áp dụng lọc
            </button>
          </div>
        </div>

        <div className="text-xs text-gray-500 mt-3">
          Bộ lọc: {qHint}. Đang hiển thị {books.length} sách.
        </div>

        {!!errMsg && <div className="mt-3 text-sm text-red-600">Lỗi tải dữ liệu: {errMsg}</div>}
      </div>

      {/* List */}
      {loading ? (
        <div>Đang tải...</div>
      ) : (
        <div className="space-y-3">
          {books.map((b) => {
            const created = b.created_at ? new Date(b.created_at).toLocaleString("vi-VN") : "—";

            return (
              <div key={b.id} className="border rounded-xl p-4 bg-white hover:bg-gray-50">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold">{b.title}</div>
                    <div className="text-sm text-gray-600 mt-1">
                      <span className="mr-3">
                        <b>Đơn vị:</b> {b.unit_name || "—"}
                      </span>
                      <span className="mr-3">
                        <b>Ngày tạo:</b> {created}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">ID: {b.id}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      console.log("Go to book", b.id); // để bạn thấy click có chạy
                      router.push(`/books/${b.id}`);
                    }}
                    className="inline-flex items-center justify-center px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                    >
                    Mở
                  </button>
                </div>
              </div>
            );
          })}

          {!books.length && (
            <div className="text-gray-600">Chưa có sách nào được phân quyền (hoặc bộ lọc không khớp).</div>
          )}
        </div>
      )}
    </div>
  );
}
