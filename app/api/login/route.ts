import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const { password } = await request.json();
  const expected = process.env.SITE_PASSWORD;

  if (!expected) {
    // Fail closed if the env var isn't set — never accept any login if
    // the server hasn't been told what the password should be.
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  if (password !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("cb_auth", expected, {
    httpOnly: true,    // not readable from client-side JS
    secure: true,      // only sent over HTTPS
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
