import { NextRequest, NextResponse } from "next/server";

// Pre-launch access wall: every page and API request requires the
// cb_auth cookie set to the value of process.env.SITE_PASSWORD. The
// password is server-side only — never exposed to clients, never
// hardcoded in this file. When we're ready to open the site to the
// public, this whole guard goes away and we revert to the
// previously-shipped "public by default, /admin gated" model.

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The login page + the API that issues the cookie must stay reachable.
  if (pathname === "/login" || pathname === "/api/login") {
    return NextResponse.next();
  }

  const expected = process.env.SITE_PASSWORD;
  const auth = request.cookies.get("cb_auth");
  if (expected && auth?.value === expected) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
