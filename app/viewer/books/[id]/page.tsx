"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

const BTN = "inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium hover:bg-gray-50";
const FRAME = "w-full h-[78vh] rounded-xl border bg-white";

export default function ViewerBookPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const bookId = params?.id;

  const [loading, setLoading] = useState(true);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setErr(null);
      setLoading(true);
      setPdfUrl(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }

      const res = await fetch(`/api/viewer/pdf-url?book_id=${encodeURIComponent(bookId)}`);
      const j = await res.json().catch(() => ({}));

      if (!res.ok) {
        setErr(j?.error || `HTTP ${res.status}`);
        setLoading(false);
        return;
      }

      setPdfUrl(j.url || null);
      setLoading(false);
    })();
  }, [bookId, router]);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link className={BTN} href="/viewer">← Thư viện</Link>
          <Link className={BTN} href="/books">Workspace</Link>
        </div>

        {pdfUrl && (
          <a className={BTN} href={pdfUrl} target="_blank" rel="noreferrer">
            Mở tab mới
          </a>
        )}
      </div>

      {loading && <div className="text-sm text-gray-600">Đang tải PDF…</div>}
      {err && <div className="text-sm text-red-600">Lỗi: {err}</div>}

      {!loading && !err && pdfUrl && (
        <iframe className={FRAME} src={pdfUrl} />
      )}
    </div>
  );
}
