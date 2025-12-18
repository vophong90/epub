"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Book = { id: string; title: string; unit_name: string | null };
type BookVersion = {
  id: string;
  version_name: string;
  status: string;
  created_at: string;
};

export default function BookDetailPage() {
  const params = useParams<{ id: string }>();
  const bookId = useMemo(() => (params?.id ? String(params.id) : ""), [params]);

  const [loading, setLoading] = useState(true);
  const [book, setBook] = useState<Book | null>(null);
  const [versions, setVersions] = useState<BookVersion[]>([]);
  const [role, setRole] = useState<string | null>(null); // viewer|author|editor

  useEffect(() => {
    if (!bookId) return;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = "/login";
        return;
      }

      // Book
      const { data: b, error: bErr } = await supabase
        .from("books")
        .select("id,title,unit_name")
        .eq("id", bookId)
        .maybeSingle();
      if (bErr) console.error("book select error:", bErr);
      setBook((b as any) || null);

      // My role in this book (for UI gating only; RLS is source of truth)
      const { data: perm, error: pErr } = await supabase
        .from("book_permissions")
        .select("role")
        .eq("book_id", bookId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (pErr) console.error("book_permissions select error:", pErr);
      setRole((perm as any)?.role ?? null);

      // Versions
      const { data: v, error: vErr } = await supabase
        .from("book_versions")
        .select("id,version_name,status,created_at")
        .eq("book_id", bookId)
        .order("created_at", { ascending: false });
      if (vErr) console.error("book_versions select error:", vErr);
      setVersions((v as any) || []);

      setLoading(false);
    })();
  }, [bookId]);

  if (loading) return <div className="p-6">Đang tải...</div>;
  if (!book) return <div className="p-6">Không tìm thấy sách.</div>;

  const canEditToc = role === "editor";
  const canEditContent = role === "editor" || role === "author";

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-gray-500">{book.unit_name || ""}</div>
          <h1 className="text-2xl font-bold">{book.title}</h1>
          <div className="mt-1 text-sm text-gray-600">
            Quyền của bạn: <span className="font-semibold">{role || "(không rõ)"}</span>
            {role && (
              <>
                {" "}· TOC: {canEditToc ? "Sửa" : "Xem"} · Nội dung: {canEditContent ? "Sửa" : "Xem"}
              </>
            )}
          </div>
        </div>

        <Link href="/books" className="px-3 py-2 rounded-lg border hover:bg-gray-50">
          ← Quay lại danh sách sách
        </Link>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Phiên bản</h2>
        </div>

        <div className="space-y-3">
          {versions.map((v) => (
            <div key={v.id} className="border rounded-xl p-4 flex items-center justify-between">
              <div>
                <div className="font-semibold">{v.version_name}</div>
                <div className="text-sm text-gray-600">
                  Trạng thái: {v.status} · Tạo lúc: {new Date(v.created_at).toLocaleString()}
                </div>
              </div>
              <Link
                href={`/books/${bookId}/toc/${v.id}`}
                className="px-3 py-2 rounded-lg border hover:bg-gray-50"
              >
                Mở TOC
              </Link>
            </div>
          ))}

          {!versions.length && (
            <div className="text-gray-600 border rounded-xl p-4">
              Chưa có phiên bản nào cho sách này. (Nếu cần, tạo version trong Supabase trước —
              sau đó refresh trang.)
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
