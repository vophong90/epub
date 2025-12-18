
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "EPUB – Khoa Y học cổ truyền",
    template: "%s | Khoa Y học cổ truyền"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <header style={{display:'flex',gap:'8px',padding:'12px',borderBottom:'1px solid #ddd'}}>
          <img src="/logo-square.png" style={{height:32,width:32}} />
          <strong>EPUB – Khoa Y học cổ truyền</strong>
        </header>
        <main style={{padding:24}}>{children}</main>
      </body>
    </html>
  );
}
