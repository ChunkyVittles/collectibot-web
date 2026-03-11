import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { extname } from "path";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".bmp": "image/bmp",
};

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  if (!path) {
    return NextResponse.json({ error: "Missing path" }, { status: 400 });
  }

  // Only allow serving from the review folder
  if (!path.includes("/collectibot-scans/review/")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const data = await readFile(path);
    const ext = extname(path).toLowerCase();
    const mime = MIME[ext] || "application/octet-stream";
    return new NextResponse(data, {
      headers: { "Content-Type": mime, "Cache-Control": "private, max-age=3600" },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
