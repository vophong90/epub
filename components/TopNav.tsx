// components/TopNav.tsx
"use client";

import Link from "next/link";
import Image from "next/image";
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
    // sticky để header luôn dính trên, z-40 để nằm trên hero/logo
    <header className="sticky top-0 z-40 border-b bg-white/80 backdrop-blur">
      <nav
        className="
          max-w-6xl mx-auto px-4 py-3
          flex items-center justify-between gap-4 flex-nowrap
        "
      >
        {/* Bên trái: logo + menu */}
        <div className="flex items-center gap-2 min-w-0">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            {/* ✅ dùng next/image + width/height cố định,
                logo sẽ KHÔNG bao giờ phóng to toàn màn hình nữa */}
            <Image
              src="/logo-square.png"
              alt="EPUB"
              width={32}
              height={32}
              className="rounded-full shrink-0"
            />
            <span className="font-semibold whitespace-nowrap">EPUB</span>
          </Link>

          <div className="hidden md:flex items-center gap-4 ml-6 text-sm whitespace-nowrap">
            {NAV_LINKS.map((link) => {
              const isActive = pathname === link.href;
              const base = link.disabled
                ? "opacity-40 cursor-not-allowed"
                : "cursor-pointer";
              const color = isActive
                ? "text-blue-700 font-semibold"
                : "text-gray-700 hover:text-blue-700";

              return (
                <button
                  key={link.href}
                  disabled={link.disabled}
                  onClick={() => !link.disabled && router.push(link.href)}
                  className={`${base} ${color}`}
                  type="button"
                >
                  {link.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Bên phải */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {loading ? (
            // placeholder cố định để tránh nhảy layout
            <div className="h-9 w-40 rounded-full bg-gray-100 animate-pulse" />
          ) : user ? (
            <>
              <Link
                href="/books"
                className="
                  hidden sm:inline-flex items-center px-3 py-2
                  rounded-full bg-blue-600 text-white text-sm font-semibold
                  hover:bg-blue-700 whitespace-nowrap
                "
              >
                Vào My Books
              </Link>

              <button
                type="button"
                className="
                  px-3 py-2 rounded-full border text-sm
                  max-w-[220px] truncate
                "
                title={displayName || "user"}
              >
                Xin chào, {displayName || "user"}
              </button>

              <button
                type="button"
                onClick={handleLogout}
                className="
                  hidden sm:inline-flex px-3 py-2 rounded-full text-sm
                  text-gray-600 hover:bg-gray-100 whitespace-nowrap
                "
              >
                Đăng xuất
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="
                px-3 py-2 rounded-full bg-blue-600 text-white text-sm
                font-semibold hover:bg-blue-700 whitespace-nowrap
              "
            >
              Đăng nhập
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
