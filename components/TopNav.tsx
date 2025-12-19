// components/TopNav.tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/lib/supabaseClient";

export default function TopNav() {
  const { user, profile, loading } = useAuth();

  const displayName = useMemo(() => {
    return (
      profile?.name?.trim() ||
      profile?.email?.split("@")[0] ||
      user?.email?.split("@")[0] ||
      "Tài khoản"
    );
  }, [profile?.name, profile?.email, user?.email]);

  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // close dropdown when click outside
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!open) return;
      const target = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function handleLogout() {
    if (loggingOut) return;
    try {
      setLoggingOut(true);
      setOpen(false);

      const { error } = await supabase.auth.signOut();
      if (error) console.error("signOut error:", error);

      // ✅ chắc chắn thoát và không kẹt state
      window.location.href = "/login";
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <header className="border-b bg-white/80 backdrop-blur">
      <div className="mx-auto max-w-6xl px-6 py-3 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/logo-square.png"
            alt="Logo"
            width={32}
            height={32}
            className="h-8 w-8"
            priority
          />
          <span className="font-semibold text-lg">EPUB</span>
        </Link>

        <nav className="flex items-center gap-2">
          <Link
            className="px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-100"
            href="/"
          >
            Trang chủ
          </Link>

          <Link
            className="px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-100"
            href="/books"
          >
            Biên tập
          </Link>

          <span className="px-3 py-2 rounded-lg text-sm font-medium text-gray-400 cursor-not-allowed">
            Biên soạn
          </span>
          <span className="px-3 py-2 rounded-lg text-sm font-medium text-gray-400 cursor-not-allowed">
            Xuất bản
          </span>

          {/* Auth area */}
          {!loading && !user ? (
            <Link
              className="px-3 py-2 rounded-lg text-sm font-semibold hover:bg-gray-100"
              href="/login"
            >
              Đăng nhập
            </Link>
          ) : (
            <div className="relative" ref={menuRef}>
              {/* ✅ chỉ hiện tên */}
              <button
                type="button"
                className="px-3 py-2 rounded-lg text-sm font-semibold hover:bg-gray-100"
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={open}
                title={profile?.email ?? user?.email ?? ""}
              >
                {displayName}
              </button>

              {/* ✅ Đăng xuất chỉ hiện khi click tên */}
              {open && (
                <div
                  className="absolute right-0 mt-2 w-48 rounded-xl border bg-white shadow-lg overflow-hidden z-50"
                  role="menu"
                >
                  <div className="px-3 py-2 text-xs text-gray-500 border-b">
                    {profile?.email ?? user?.email ?? ""}
                  </div>

                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={loggingOut}
                    className="w-full text-left px-3 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
                    role="menuitem"
                  >
                    {loggingOut ? "Đang đăng xuất..." : "Đăng xuất"}
                  </button>
                </div>
              )}
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
