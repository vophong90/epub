// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";

import TopNav from "@/components/TopNav";
import AuthProvider from "@/components/AuthProvider";

export const metadata: Metadata = {
  title: {
    default: "EPUB – Khoa Y học cổ truyền",
    template: "%s | Khoa Y học cổ truyền",
  },
  description:
    "Nền tảng biên tập, xuất bản tài liệu số về giáo dục, đào tạo, cập nhật kiến thức y khoa liên tục.",
  // ... giữ nguyên các phần icons/openGraph/manifest như anh đang có
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className="min-h-screen bg-white text-gray-900">
        <AuthProvider>
          <TopNav />
          {/* ✅ giới hạn bề ngang để dễ nhìn */}
          <main className="mx-auto w-full max-w-6xl px-6 py-8">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
