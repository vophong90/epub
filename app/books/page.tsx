"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";

type Book = { id: string; title: string };

export default function BooksPage() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/login"; return; }

      const { data, error } = await supabase
        .from("books")
        .select("id,title")
        .order("created_at", { ascending: false });

      if (error) console.error("books select error:", error);
      if (!error && data) setBooks(data as any);

      setLoading(false);
    })();
  }, []);

  if (loading) return <div>Đang tải...</div>;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Sách của tôi</h1>
        <button
          className="px-3 py-2 rounded-lg border"
          onClick={async () => { await supabase.auth.signOut(); window.location.href="/login"; }}
        >
          Đăng xuất
        </button>
      </div>

      <div className="space-y-3">
        {books.map((b) => (
          <Link key={b.id} href={`/books/${b.id}`} className="block border rounded-xl p-4 hover:bg-gray-50">
            <div className="font-semibold">{b.title}</div>
          </Link>
        ))}
        {!books.length && <div className="text-gray-600">Chưa có sách nào được phân quyền.</div>}
      </div>
    </div>
  );
}
