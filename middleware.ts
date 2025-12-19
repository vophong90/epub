// middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });

  const { data: { session } } = await supabase.auth.getSession();
  const url = req.nextUrl.clone();

  if (!session && url.pathname.startsWith("/books")) {
    url.pathname = "/login";
    url.searchParams.set(
      "redirectTo",
      req.nextUrl.pathname + req.nextUrl.search
    );
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ["/books/:path*"],
};
