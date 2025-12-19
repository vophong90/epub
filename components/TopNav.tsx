"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "./AuthProvider";

const NAV_LINKS = [
  { href: "/", label: "Trang chủ" },
  { href: "/books", label: "Biên tập" },
  { href: "/publish", label: "Xuất bản" },
  { href: "/viewer", label: "Xem tài liệu" },
];

export default function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, loading } = useAuth();

  const displayName =
    profile?.name ||
    (user?.user_metadata as any)?.full_name ||
    user?.email ||
    "User";

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b bg-white/80 backdrop-blur">
      <nav className="max-w-6xl mx-auto px-4 py-3">
        {/* Hàng 1: logo + user */}
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <Image
              src="/logo-square.png"
              alt="EPUB"
              width={32}
              height={32}
              className="rounded-full"
            />
            <span className="font-semibold whitespace-nowrap">EPUB</span>
          </Link>

          <div className="shrink-0">
            {loading ? (
              <div className="h-9 w-40 rounded-full bg-gray-100 animate-pulse" />
            ) : user ? (
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setOpen((v) => !v)}
                  className="px-3 py-2 rounded-full border text-sm max-w-[260px] truncate hover:bg-gray-50"
                  title={displayName}
                >
                  {displayName}
                </button>

                {open && (
                  <div className="absolute right-0 mt-2 w-44 rounded-xl border bg-white shadow-lg overflow-hidden">
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                      onClick={async () => {
                        setOpen(false);
                        await handleLogout();
                      }}
                    >
                      Đăng xuất
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link
                href="/login"
                className="px-3 py-2 rounded-full bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 whitespace-nowrap"
              >
                Đăng nhập
              </Link>
            )}
          </div>
        </div>

        {/* Hàng 2: menu (1 bản duy nhất, tự wrap) */}
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          {NAV_LINKS.map((link) => {
            const isActive =
              pathname === link.href || pathname.startsWith(link.href + "/");
            const cls = isActive
              ? "text-blue-700 font-semibold"
              : "text-gray-700 hover:text-blue-700";
            return (
              <button
                key={link.href}
                type="button"
                className={`${cls} whitespace-nowrap`}
                onClick={() => router.push(link.href)}
              >
                {link.label}
              </button>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
