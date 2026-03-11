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

  // R2 key path (e.g. "pending/foo.webp") — fetch from R2
  if (path.startsWith("pending/") || path.startsWith("comics/")) {
    try {
      const accountId = process.env.R2_ACCOUNT_ID || "";
      const accessKeyId = process.env.R2_ACCESS_KEY_ID || "";
      const secretKey = process.env.R2_SECRET_ACCESS_KEY || "";
      const bucket = process.env.R2_BUCKET || "collectibot-scans";

      // Reuse the same signing logic as the public image endpoint
      const response = await fetchFromR2(bucket, path, accessKeyId, secretKey, accountId);

      if (!response.ok) {
        return NextResponse.json({ error: "R2 fetch failed" }, { status: 502 });
      }

      const data = await response.arrayBuffer();
      const ext = extname(path).toLowerCase();
      const mime = MIME[ext] || "image/webp";
      return new NextResponse(data, {
        headers: { "Content-Type": mime, "Cache-Control": "public, max-age=86400" },
      });
    } catch {
      return NextResponse.json({ error: "R2 fetch error" }, { status: 500 });
    }
  }

  // Local file path (legacy) — only allow from review folder
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

async function fetchFromR2(
  bucket: string,
  key: string,
  accessKeyId: string,
  secretAccessKey: string,
  accountId: string,
): Promise<Response> {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${bucket}/${key}`;

  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const shortDate = dateStamp.substring(0, 8);
  const region = "auto";
  const service = "s3";
  const credentialScope = `${shortDate}/${region}/${service}/aws4_request`;

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\nx-amz-date:${dateStamp}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "GET",
    `/${bucket}/${key}`,
    "",
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const encoder = new TextEncoder();
  const canonicalRequestHash = await sha256Hex(encoder.encode(canonicalRequest));

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    dateStamp,
    credentialScope,
    canonicalRequestHash,
  ].join("\n");

  const kDate = await hmacSha256(encoder.encode(`AWS4${secretAccessKey}`), encoder.encode(shortDate));
  const kRegion = await hmacSha256(kDate, encoder.encode(region));
  const kService = await hmacSha256(kRegion, encoder.encode(service));
  const kSigning = await hmacSha256(kService, encoder.encode("aws4_request"));

  const signature = await hmacSha256Hex(kSigning, encoder.encode(stringToSign));

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(url, {
    headers: {
      Host: host,
      "x-amz-date": dateStamp,
      "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
      Authorization: authorization,
    },
  });
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hash = await crypto.subtle.digest("SHA-256", data as any);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function hmacSha256(key: any, data: any): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, data);
}

async function hmacSha256Hex(key: any, data: any): Promise<string> {
  const sig = await hmacSha256(key, data);
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
