// app/books/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

function withTimeout<T>(p: PromiseLike<T>, ms: number, label = "timeout"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(label)), ms);
    p.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      }
    );
  });
}

export default function BooksPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string>("");

  // Filters
  const [q, setQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
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

  // ✅ Guard auth
  useEffect(() => {
    console.log("[BooksPage] auth state", { authLoading, user }); // 🔴 log thêm
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  async function loadBooks() {
    const myReqId = ++reqIdRef.current;

    setErrMsg("");
    setLoading(true);

    try {
      if (authLoading) {
        console.log("[BooksPage] loadBooks aborted: authLoading still true"); // 🔴
        return;
      }
      if (!user) {
        console.log("[BooksPage] loadBooks aborted: no user"); // 🔴
        router.replace("/login");
        return;
      }

      console.log("[BooksPage] loadBooks start", { sortDir, q, dateFrom, dateTo }); // 🔴

      let queryBuilder = supabase
        .from("books")
        .select("id,title,created_at,unit_name")
        .order("created_at", { ascending: sortDir === "asc" });

      const qTrim = q.trim();
      if (qTrim) queryBuilder = queryBuilder.ilike("title", `%${qTrim}%`);
      if (dateFrom) queryBuilder = queryBuilder.gte("created_at", toISOStartOfDay(dateFrom));
      if (dateTo) queryBuilder = queryBuilder.lte("created_at", toISOEndOfDay(dateTo));

      // supabase-js trả Promise; mình chỉ chờ kết quả
      const { data, error } = await withTimeout(
        queryBuilder as any,
        12000,
        "query timeout"
      );

      if (error) throw error;
      if (!mountedRef.current || myReqId !== reqIdRef.current) return;

      console.log("[BooksPage] loadBooks ok, count =", (data || []).length); // 🔴
      setBooks((data || []) as any);
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

  // ✅ Load lần đầu
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

  // 🔴 handler riêng cho nút Mở
  const handleOpenBook = (id: string) => {
    console.log("[BooksPage] click Mở", id);
    router.push(`/books/${id}`);
  };

  if (authLoading) return <div className="max-w-4xl mx-auto px-4 py-6">Đang xác thực...</div>;
  if (!user) return null;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold">Sách của tôi</h1>
      </div>

      {/* Filters */}
      <div className="border rounded-xl p-4 bg-white mb-5">
        {/* ... phần filter giữ nguyên ... */}

        <div className="text-xs text-gray-500 mt-3">
          Bộ lọc: {qHint}. Đang hiển thị {books.length} sách.
        </div>

        {!!errMsg && (
          <div className="mt-3 text-sm text-red-600">
            Lỗi tải dữ liệu: {errMsg}
          </div>
        )}
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

                  {/* 🔴 đổi Link → button gọi router.push để debug rõ */}
                  <button
                    type="button"
                    onClick={() => handleOpenBook(b.id)}
                    className="inline-flex items-center justify-center px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                  >
                    Mở
                  </button>
                </div>
              </div>
            );
          })}

          {!books.length && (
            <div className="text-gray-600">
              Chưa có sách nào được phân quyền (hoặc bộ lọc không khớp).
            </div>
          )}
        </div>
      )}
    </div>
  );
}
