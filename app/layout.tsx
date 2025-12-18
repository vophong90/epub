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
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    title: "EPUB – Khoa Y học cổ truyền",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className="min-h-screen bg-white text-gray-900">
        <AuthProvider>
          <TopNav />
          <main className="p-6">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
