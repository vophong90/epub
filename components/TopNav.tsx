// components/TopNav.tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/components/AuthProvider";

const NAV = [
  { href: "/", label: "Trang chủ" },
  { href: "/edit", label: "Biên tập" },
  { href: "/compose", label: "Biên soạn" },
  { href: "/publish", label: "Xuất bản" },
];

export default function TopNav() {
  const { user, loading } = useAuth();

  const displayName =
    (user?.user_metadata?.name as string | undefined) ||
    (user?.email ? user.email.split("@")[0] : null) ||
    null;

  return (
    <header className="border-b bg-white/80 backdrop-blur">
      <div className="mx-auto max-w-7xl px-6 py-3 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/logo-square.png" alt="Logo" width={32} height={32} className="h-8 w-8" />
          <span className="font-semibold text-lg">EPUB</span>
        </Link>

        <nav className="flex items-center gap-2">
          {NAV.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className="px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-100"
            >
              {it.label}
            </Link>
          ))}

          {!loading && !user ? (
            <Link
              href="/login"
              className="px-3 py-2 rounded-lg text-sm font-semibold hover:bg-gray-100"
            >
              Đăng nhập
            </Link>
          ) : (
            <Link
              href="/account"
              className="px-3 py-2 rounded-lg text-sm font-semibold hover:bg-gray-100"
              title={user?.email ?? ""}
            >
              {displayName ?? "Tài khoản"}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
