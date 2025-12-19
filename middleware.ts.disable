// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";

export async function middleware(req: NextRequest) {
  // luôn tạo sẵn response để Supabase có thể gắn/refresh cookie
  const res = NextResponse.next();

  const supabase = createMiddlewareClient({ req, res });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const url = req.nextUrl;
  const pathname = url.pathname;

  // Những path cần login
  const protectedPrefixes = ["/books", "/book"];

  const isProtected = protectedPrefixes.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );

  // 1) Chưa login mà vào /books, /book/...  => chuyển về /login?redirectTo=...
  if (isProtected && !session) {
    const redirectUrl = new URL("/login", req.url);
    redirectUrl.searchParams.set("redirectTo", pathname + url.search);
    return NextResponse.redirect(redirectUrl);
  }

  // 2) Đã login rồi mà còn ở /login => đẩy sang redirectTo (mặc định /books)
  if (pathname === "/login" && session) {
    const redirectTo = url.searchParams.get("redirectTo") || "/books";
    return NextResponse.redirect(new URL(redirectTo, req.url));
  }

  // 3) Các request khác thì cho qua
  return res;
}

// Bỏ qua static, image, icon...
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico)).*)",
  ],
};
