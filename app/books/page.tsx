"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";

type Book = {
  id: string;
  title: string;
  unit_name: string | null;
  created_at: string | null;
};

type SortOrder = "newest" | "oldest";

const INPUT =
  "w-full border rounded-lg px-3 py-2 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-200";
const BTN =
  "inline-flex items-center justify-center px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed";
const BTN_PRIMARY =
  "inline-flex items-center justify-center px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed";

export default function BooksPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // filters
  const [searchTitle, setSearchTitle] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");

  // create book
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newUnitName, setNewUnitName] = useState("Khoa Y học cổ truyền");
  const [creating, setCreating] = useState(false);

  // ===== LOAD BOOKS =====
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push("/login");
      return;
    }

    const load = async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const { data, error } = await supabase
          .from("books")
          .select("id,title,unit_name,created_at")
          .order("created_at", { ascending: false });

        if (error) {
          setErrorMsg(error.message);
          setBooks([]);
        } else {
          setBooks((data || []) as Book[]);
        }
      } catch (e: any) {
        setErrorMsg(e?.message || "Lỗi khi tải danh sách sách");
        setBooks([]);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [authLoading, user, router]);

  // ===== FILTER + SORT =====
  const filteredBooks = useMemo(() => {
    let list = [...books];

    if (searchTitle.trim()) {
      const kw = searchTitle.trim().toLowerCase();
      list = list.filter((b) =>
        b.title.toLowerCase().includes(kw)
      );
    }

    if (fromDate) {
      const from = new Date(`${fromDate}T00:00:00`);
      list = list.filter((b) => {
        if (!b.created_at) return false;
        return new Date(b.created_at) >= from;
      });
    }

    if (toDate) {
      const to = new Date(`${toDate}T23:59:59`);
      list = list.filter((b) => {
        if (!b.created_at) return false;
        return new Date(b.created_at) <= to;
      });
    }

    list.sort((a, b) => {
      const da = a.created_at ? new Date(a.created_at).getTime() : 0;
      const db = b.created_at ? new Date(b.created_at).getTime() : 0;
      return sortOrder === "newest" ? db - da : da - db;
    });

    return list;
  }, [books, searchTitle, fromDate, toDate, sortOrder]);

  // ===== CREATE BOOK =====
  async function handleCreateBook() {
    if (!user) return;
    if (!newTitle.trim()) {
      setErrorMsg("Tiêu đề sách là bắt buộc");
      return;
    }

    setCreating(true);
    setErrorMsg(null);
    try {
      // 1) Tạo book
      const { data: bookRow, error: bErr } = await supabase
        .from("books")
        .insert({
          title: newTitle.trim(),
          unit_name: newUnitName.trim() || "Khoa Y học cổ truyền",
          created_by: user.id,
        })
        .select("id,title,unit_name,created_at")
        .maybeSingle();

      if (bErr || !bookRow) {
        setErrorMsg(
          bErr?.message || "Không tạo được sách mới"
        );
        return;
      }

      // 2) Gán quyền editor cho chính user
      const { error: pErr } = await supabase
        .from("book_permissions")
        .insert({
          book_id: bookRow.id,
          user_id: user.id,
          role: "editor",
        });

      if (pErr) {
        // không fail cứng; nhưng báo cho user biết
        setErrorMsg(
          `Đã tạo sách nhưng không gán được quyền editor: ${pErr.message}`
        );
      } else {
        setErrorMsg(null);
      }

      // 3) Cập nhật list
      setBooks((prev) => [bookRow as Book, ...prev]);
      setShowCreateForm(false);
      setNewTitle("");
      setNewUnitName("Khoa Y học cổ truyền");

      // 4) Điều hướng trực tiếp vào trang chi tiết sách
      router.push(`/books/${bookRow.id}`);
    } catch (e: any) {
      setErrorMsg(
        e?.message || "Lỗi không xác định khi tạo sách mới"
      );
    } finally {
      setCreating(false);
    }
  }

  function handleResetFilters() {
    setSearchTitle("");
    setFromDate("");
    setToDate("");
    setSortOrder("newest");
  }

  // ===== RENDER =====
  return (
    <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Sách của tôi</h1>

        <div className="flex flex-wrap items-center gap-2">
          <button
            className={BTN_PRIMARY}
            onClick={() => setShowCreateForm((v) => !v)}
          >
            {showCreateForm ? "Đóng khung tạo sách" : "Tạo sách mới"}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      {/* Khung tạo sách mới */}
      {showCreateForm && (
        <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 md:p-6 space-y-4">
          <h2 className="font-semibold text-lg">Tạo sách mới</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">
                Tên sách <span className="text-red-500">*</span>
              </label>
              <input
                className={INPUT}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Ví dụ: Các vấn đề lâm sàng thiết yếu"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Đơn vị</label>
              <input
                className={INPUT}
                value={newUnitName}
                onChange={(e) => setNewUnitName(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className={BTN_PRIMARY}
              onClick={handleCreateBook}
              disabled={creating}
            >
              {creating ? "Đang tạo..." : "Lưu và mở sách"}
            </button>
            <button
              className={BTN}
              type="button"
              onClick={() => setShowCreateForm(false)}
            >
              Hủy
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Khi tạo thành công, bạn sẽ được gán quyền{" "}
            <strong>editor</strong> cho sách này thông qua bảng{" "}
            <code className="font-mono text-[11px]">
              book_permissions
            </code>
            .
          </p>
        </section>
      )}

      {/* Bộ lọc */}
      <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 md:p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">
              Tìm theo tên sách
            </label>
            <input
              className={INPUT}
              placeholder="Nhập tên sách..."
              value={searchTitle}
              onChange={(e) => setSearchTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Từ ngày tạo</label>
            <input
              type="date"
              className={INPUT}
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Đến ngày tạo</label>
            <input
              type="date"
              className={INPUT}
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">Sắp xếp:</span>
            <button
              type="button"
              className={`${BTN} text-xs ${
                sortOrder === "newest"
                  ? "border-blue-500 text-blue-600"
                  : ""
              }`}
              onClick={() => setSortOrder("newest")}
            >
              Mới → Cũ
            </button>
            <button
              type="button"
              className={`${BTN} text-xs ${
                sortOrder === "oldest"
                  ? "border-blue-500 text-blue-600"
                  : ""
              }`}
              onClick={() => setSortOrder("oldest")}
            >
              Cũ → Mới
            </button>
          </div>

          <div className="flex flex-wrap gap-2 ml-auto">
            <button
              type="button"
              className={BTN}
              onClick={handleResetFilters}
            >
              Xóa lọc
            </button>
          </div>
        </div>

        <p className="text-xs text-gray-500">
          Bộ lọc: đang hiển thị{" "}
          <strong>{filteredBooks.length}</strong> /{" "}
          <strong>{books.length}</strong> sách.
        </p>
      </section>

      {/* Danh sách sách */}
      <section className="space-y-3">
        {loading ? (
          <p className="text-sm text-gray-600">Đang tải danh sách...</p>
        ) : filteredBooks.length === 0 ? (
          <p className="text-sm text-gray-600">
            Không có sách nào phù hợp.
          </p>
        ) : (
          filteredBooks.map((b) => (
            <article
              key={b.id}
              className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 md:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
            >
              <div className="space-y-1">
                <h3 className="font-semibold text-base md:text-lg">
                  {b.title}
                </h3>
                <p className="text-sm text-gray-600">
                  Đơn vị: {b.unit_name || "Khoa Y học cổ truyền"}
                </p>
                <p className="text-xs text-gray-500">
                  Ngày tạo:{" "}
                  {b.created_at
                    ? new Date(b.created_at).toLocaleString()
                    : "Không rõ"}
                </p>
                <p className="text-[11px] text-gray-400">
                  ID: <span className="font-mono">{b.id}</span>
                </p>
              </div>
              <button
                className={`${BTN_PRIMARY} w-full md:w-auto`}
                onClick={() => router.push(`/books/${b.id}`)}
              >
                Mở
              </button>
            </article>
          ))
        )}
      </section>
    </main>
  );
}
