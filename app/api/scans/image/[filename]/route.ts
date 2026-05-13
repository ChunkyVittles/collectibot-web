import { NextResponse } from "next/server";
import pool from "@/app/lib/db";
import { SLUG_TO_ID } from "@/app/lib/issue-slugs";

// Descriptive image URL: /api/scans/image/{issue-slug}-{front|back}-cover.webp
// Resolves the slug to an issue id, then serves the front/back cover from R2.
// This keeps the user-visible image URL keyword-rich for SEO without moving
// any actual R2 objects.

type RouteParams = {
  params: Promise<{ filename: string }>;
};

export async function GET(_req: Request, { params }: RouteParams) {
  const { filename } = await params;

  const stripped = filename.replace(/\.webp$/i, "");
  let side: "front" | "back" | null = null;
  let issueSlug: string | null = null;

  if (stripped.endsWith("-front-cover")) {
    side = "front";
    issueSlug = stripped.slice(0, -"-front-cover".length);
  } else if (stripped.endsWith("-back-cover")) {
    side = "back";
    issueSlug = stripped.slice(0, -"-back-cover".length);
  }

  if (!side || !issueSlug) {
    return NextResponse.json(
      { error: "Filename must end with -front-cover.webp or -back-cover.webp" },
      { status: 400 },
    );
  }

  const issueId = SLUG_TO_ID[issueSlug];
  if (!issueId) {
    return NextResponse.json({ error: "Unknown issue slug" }, { status: 404 });
  }

  const scanType = side === "back" ? "back_cover" : "front_cover";
  const result = await pool.query<{ image_url: string }>(
    `SELECT image_url FROM scans
     WHERE issue_id = $1 AND scan_type = $2
     ORDER BY uploaded_at DESC LIMIT 1`,
    [issueId, scanType],
  );
  if (result.rows.length === 0) {
    return NextResponse.json({ error: "No scan found" }, { status: 404 });
  }

  let key = result.rows[0].image_url;
  const r2DevMatch = key.match(/r2\.dev\/(.+)$/);
  if (r2DevMatch) key = r2DevMatch[1];

  const accountId = process.env.R2_ACCOUNT_ID || "73dc075a05ec7910d286e84df20b0960";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || "";
  const secretKey = process.env.R2_SECRET_ACCESS_KEY || "";
  const bucket = process.env.R2_BUCKET || "collectibot-scans";

  try {
    const response = await fetchFromR2(bucket, key, accessKeyId, secretKey, accountId);
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return NextResponse.json(
        { error: "Failed to fetch image", status: response.status, detail: errText, key },
        { status: 502 },
      );
    }
    const data = await response.arrayBuffer();
    return new NextResponse(data, {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "R2 fetch error" }, { status: 500 });
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
  /* eslint-disable @typescript-eslint/no-explicit-any */
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
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, data);
}

async function hmacSha256Hex(key: any, data: any): Promise<string> {
  const sig = await hmacSha256(key, data);
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
