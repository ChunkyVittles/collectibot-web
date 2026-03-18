import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow login page, login API, and public scan endpoints through
  if (pathname === "/login" || pathname === "/api/login" || pathname.startsWith("/api/scans/") || pathname.startsWith("/postcards")) {
    return NextResponse.next();
  }

  // Check for auth cookie
  const auth = request.cookies.get("cb_auth");
  if (auth?.value === "Testing123") {
    return NextResponse.next();
  }

  // Redirect to login
  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
