import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "EPUB – Khoa Y học cổ truyền",
    template: "%s | Khoa Y học cổ truyền",
  },
  description: "Thư viện sách/chuyên đề – Khoa Y học cổ truyền",
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
        <header className="border-b px-6 py-3 flex items-center gap-3">
          <img src="/logo-square.png" alt="Logo" className="h-8 w-8" />
          <span className="font-semibold text-lg">
            EPUB – Khoa Y học cổ truyền
          </span>
        </header>
        <main className="p-6">{children}</main>
      </body>
    </html>
  );
}
