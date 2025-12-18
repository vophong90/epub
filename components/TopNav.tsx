// components/TopNav.tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/lib/supabaseClient";

export default function TopNav() {
  const { user, profile, loading } = useAuth();

  const displayName =
    profile?.name?.trim() ||
    profile?.email?.split("@")[0] ||
    user?.email?.split("@")[0] ||
    "Tài khoản";

  async function handleLogout() {
    await supabase.auth.signOut();
    // không cần router; AuthProvider sẽ update state, UI tự đổi sang "Đăng nhập"
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
          />
          <span className="font-semibold text-lg">EPUB</span>
        </Link>

        <nav className="flex items-center gap-2">
          <Link className="px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-100" href="/">
            Trang chủ
          </Link>

          <Link className="px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-100" href="/books">
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
            <Link className="px-3 py-2 rounded-lg text-sm font-semibold hover:bg-gray-100" href="/login">
              Đăng nhập
            </Link>
          ) : (
            <div className="flex items-center gap-1">
              <span
                className="px-3 py-2 rounded-lg text-sm font-semibold"
                title={profile?.email ?? user?.email ?? ""}
              >
                {displayName}
              </span>

              {/* ✅ nút Đăng xuất */}
              <button
                onClick={handleLogout}
                className="px-3 py-2 rounded-lg text-sm font-semibold hover:bg-gray-100"
                type="button"
              >
                Đăng xuất
              </button>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
