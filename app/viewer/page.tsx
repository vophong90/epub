"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type PubRow = {
  book_id: string;
  published_at: string;
  books: { title: string; unit_name: string } | null;
};

const CARD = "rounded-xl border bg-white p-4 shadow-sm";
const BTN = "inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium hover:bg-gray-50";

export default function ViewerHomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PubRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setErr(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }

      // list tất cả sách đã publish (is_active=true) — mọi user login đều xem
      const { data, error } = await supabase
        .from("book_publications")
        .select("book_id, published_at, books(title, unit_name)")
        .eq("is_active", true)
        .order("published_at", { ascending: false });

      if (error) setErr(error.message);
      setRows((data as any) || []);
      setLoading(false);
    })();
  }, [router]);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-end justify-between gap-3">
        <h1 className="text-xl font-semibold">Thư viện (Viewer)</h1>
        <Link className={BTN} href="/books">Về workspace</Link>
      </div>

      {loading && <div className="text-sm text-gray-600">Đang tải…</div>}
      {err && <div className="text-sm text-red-600">Lỗi: {err}</div>}

      {!loading && !err && rows.length === 0 && (
        <div className="text-sm text-gray-600">Chưa có sách nào được publish PDF.</div>
      )}

      <div className="grid grid-cols-1 gap-3">
        {rows.map((r) => (
          <div key={r.book_id} className={CARD}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold">
                  {r.books?.title || "(Không có tiêu đề)"}
                </div>
                <div className="text-sm text-gray-600">
                  {r.books?.unit_name || ""} • Publish:{" "}
                  {r.published_at ? new Date(r.published_at).toLocaleString() : ""}
                </div>
              </div>

              <Link className={BTN} href={`/viewer/books/${r.book_id}`}>
                Mở PDF
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
