import { NextRequest, NextResponse } from "next/server";

// Paths that require the admin auth cookie. Everything else is public so
// search engines can crawl issue/series/creator/postcard pages.
const PROTECTED_PREFIXES = ["/admin/", "/api/admin/"];

// Destructive scan endpoints that live under /api/scans/ but mutate state.
// Listed explicitly so /api/scans/recent and /api/scans/image stay public.
const PROTECTED_SCAN_ENDPOINTS = new Set([
  "/api/scans/delete",
  "/api/scans/swap",
  "/api/scans/reassign",
]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const needsAuth =
    PROTECTED_PREFIXES.some((p) => pathname.startsWith(p)) ||
    PROTECTED_SCAN_ENDPOINTS.has(pathname);

  if (!needsAuth) {
    return NextResponse.next();
  }

  const auth = request.cookies.get("cb_auth");
  if (auth?.value === "Testing123") {
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
