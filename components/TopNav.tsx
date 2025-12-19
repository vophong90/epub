// components/TopNav.tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "./AuthProvider";

const NAV_LINKS = [
  { href: "/", label: "Trang chủ" },
  { href: "/books", label: "Biên tập" },
  { href: "/drafts", label: "Biên soạn", disabled: true },
  { href: "/publish", label: "Xuất bản", disabled: true },
];

export default function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, loading } = useAuth();

  const displayName =
    profile?.name ||
    (user?.user_metadata as any)?.full_name ||
    user?.email ||
    "";

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <header className="border-b bg-white/80 backdrop-blur">
      <nav className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Link href="/" className="flex items-center gap-2">
            <img
              src="/logo-square.png"
              alt="EPUB"
              className="h-8 w-8 rounded-full"
            />
            <span className="font-semibold">EPUB</span>
          </Link>

          <div className="hidden md:flex items-center gap-4 ml-6 text-sm">
            {NAV_LINKS.map((link) => (
              <button
                key={link.href}
                disabled={link.disabled}
                onClick={() => !link.disabled && router.push(link.href)}
                className={`${
                  pathname === link.href
                    ? "text-blue-700 font-semibold"
                    : "text-gray-700 hover:text-blue-700"
                } ${link.disabled ? "opacity-40 cursor-not-allowed" : ""}`}
              >
                {link.label}
              </button>
            ))}
          </div>
        </div>

        {/* Góc phải */}
        <div className="flex items-center gap-2">
          {/* khi còn loading: tránh nhảy chữ liên tục */}
          {loading ? (
            <div className="h-9 w-32 rounded-full bg-gray-100 animate-pulse" />
          ) : user ? (
            <>
              <Link
                href="/books"
                className="hidden sm:inline-flex items-center px-3 py-2 rounded-full bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
              >
                Vào My Books
              </Link>
              <button className="px-3 py-2 rounded-full border text-sm">
                Xin chào, {displayName || "user"}
              </button>
              <button
                onClick={handleLogout}
                className="hidden sm:inline-flex px-3 py-2 rounded-full text-sm text-gray-600 hover:bg-gray-100"
              >
                Đăng xuất
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="px-3 py-2 rounded-full bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
            >
              Đăng nhập
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
