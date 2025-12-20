"use client";

import React, { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  // Kiểm tra xem link còn hợp lệ & đã có session chưa
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      if (!data?.session) {
        setErr(
          "Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu liên kết mới."
        );
      }
      setSessionReady(true);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setNotice(null);

    if (!pw || !pw2) {
      setErr("Vui lòng nhập đầy đủ mật khẩu mới và xác nhận.");
      return;
    }
    if (pw !== pw2) {
      setErr("Mật khẩu xác nhận không khớp.");
      return;
    }
    if (pw.length < 8) {
      setErr("Mật khẩu mới cần ít nhất 8 ký tự.");
      return;
    }

    try {
      setLoading(true);
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      setNotice("Đã cập nhật mật khẩu thành công. Bạn sẽ được chuyển đến trang đăng nhập.");
      // Cho user đọc thông báo chút rồi quay về /login
      setTimeout(() => {
        router.replace("/login");
      }, 2000);
    } catch (e: any) {
      setErr(e?.message ?? "Không thể cập nhật mật khẩu.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 to-white p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6">
          <div className="h-12 w-12 grid place-items-center rounded-2xl bg-brand-600 text-white text-lg font-bold">
            EP
          </div>
          <h1 className="mt-4 text-2xl font-semibold">Đặt lại mật khẩu</h1>
          <p className="text-sm text-slate-600">
            Nhập mật khẩu mới cho tài khoản EPUB của bạn.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Mật khẩu mới</label>
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              disabled={loading || !sessionReady}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-300 disabled:opacity-60"
              placeholder="••••••••"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Xác nhận mật khẩu mới</label>
            <input
              type="password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              disabled={loading || !sessionReady}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-300 disabled:opacity-60"
              placeholder="Nhập lại mật khẩu mới"
            />
          </div>

          {err && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {err}
            </div>
          )}
          {notice && (
            <div className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-700">
              {notice}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !sessionReady}
            className="w-full rounded-xl bg-brand-600 px-3 py-2 text-white hover:bg-brand-700 active:scale-[0.99] disabled:opacity-50"
          >
            {loading ? "Đang cập nhật..." : "Cập nhật mật khẩu"}
          </button>
        </form>

        <div className="mt-4 text-xs text-slate-500">
          Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.
        </div>
      </div>
    </div>
  );
}
