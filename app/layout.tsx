// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";

import TopNav from "@/components/TopNav";
import { AuthProvider } from "@/components/AuthProvider";

export const metadata: Metadata = {
  title: "EPUB",
  description:
    "Nền tảng biên tập, xuất bản tài liệu số về giáo dục, đào tạo, cập nhật kiến thức y khoa liên tục.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body className="min-h-screen bg-white text-gray-900">
        <AuthProvider>
          <TopNav />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
