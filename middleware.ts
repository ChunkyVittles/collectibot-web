import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow login page and login API through
  if (pathname === "/login" || pathname === "/api/login") {
    return NextResponse.next();
  }

  // Check for auth cookie (value may be URL-encoded by the runtime)
  const auth = request.cookies.get("cb_auth");
  const decoded = auth?.value ? decodeURIComponent(auth.value) : "";
  if (decoded === "Testing123#") {
    return NextResponse.next();
  }

  // Redirect to login
  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
