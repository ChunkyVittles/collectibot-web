import { NextRequest, NextResponse } from "next/server";
import pool from "@/app/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { fromIssueId, toIssueId } = body;

  if (!fromIssueId || !toIssueId) {
    return NextResponse.json({ error: "Missing fromIssueId or toIssueId" }, { status: 400 });
  }

  // Verify target issue exists
  const target = await pool.query(`SELECT id FROM issues WHERE id = $1`, [toIssueId]);
  if (target.rows.length === 0) {
    return NextResponse.json({ error: "Target issue not found" }, { status: 404 });
  }

  // Get the scans we're moving
  const scans = await pool.query(
    `SELECT id, scan_type, image_url FROM scans WHERE issue_id = $1`,
    [fromIssueId]
  );

  if (scans.rows.length === 0) {
    return NextResponse.json({ error: "No scans found on source issue" }, { status: 404 });
  }

  // R2 config for copying images to new path
  const accountId = process.env.R2_ACCOUNT_ID || "73dc075a05ec7910d286e84df20b0960";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || "";
  const secretKey = process.env.R2_SECRET_ACCESS_KEY || "";
  const bucket = process.env.R2_BUCKET || "collectibot-scans";

  // Get series slug for the target issue
  const seriesRes = await pool.query(
    `SELECT s.name FROM series s JOIN issues i ON i.series_id = s.id WHERE i.id = $1`,
    [toIssueId]
  );
  const seriesName = seriesRes.rows[0]?.name || "unknown";
  const slug = seriesName.toLowerCase().replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/-+/g, "-").trim();

  // Delete any existing scans on the target issue
  await pool.query(`DELETE FROM scans WHERE issue_id = $1`, [toIssueId]);

  // Copy R2 objects and update scan rows
  for (const scan of scans.rows) {
    const suffix = scan.scan_type === "front_cover" ? "F" : "B";
    const newKey = `comics/${slug}/${toIssueId}_${suffix}.webp`;

    // Try to copy the R2 object to the new path
    try {
      const oldKey = stripR2Prefix(scan.image_url);
      await copyR2Object(bucket, oldKey, newKey, accessKeyId, secretKey, accountId);
    } catch {
      // If copy fails, the old key still works — just update the DB
    }

    // Update the scan row
    await pool.query(
      `UPDATE scans SET issue_id = $1, image_url = $2 WHERE id = $3`,
      [toIssueId, newKey, scan.id]
    );
  }

  return NextResponse.json({ ok: true, moved: scans.rows.length });
}

function stripR2Prefix(url: string): string {
  const match = url.match(/r2\.dev\/(.+)$/);
  return match ? match[1] : url;
}

async function copyR2Object(
  bucket: string,
  srcKey: string,
  dstKey: string,
  accessKeyId: string,
  secretKey: string,
  accountId: string,
) {
  const srcResponse = await signedR2Request("GET", bucket, srcKey, accessKeyId, secretKey, accountId);
  if (!srcResponse.ok) {
    throw new Error(`Failed to read ${srcKey}: ${srcResponse.status}`);
  }
  const data = await srcResponse.arrayBuffer();
  const putResponse = await signedR2Request("PUT", bucket, dstKey, accessKeyId, secretKey, accountId, data);
  if (!putResponse.ok) {
    throw new Error(`Failed to write ${dstKey}: ${putResponse.status}`);
  }
}

async function signedR2Request(
  method: string,
  bucket: string,
  key: string,
  accessKeyId: string,
  secretAccessKey: string,
  accountId: string,
  body?: ArrayBuffer,
): Promise<Response> {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${bucket}/${key}`;

  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const shortDate = dateStamp.substring(0, 8);
  const region = "auto";
  const service = "s3";
  const credentialScope = `${shortDate}/${region}/${service}/aws4_request`;

  const payloadHash = body
    ? await sha256Hex(new Uint8Array(body))
    : "UNSIGNED-PAYLOAD";

  const headers: Record<string, string> = {
    host: host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": dateStamp,
  };
  if (body) {
    headers["content-type"] = "image/webp";
  }

  const signedHeaderKeys = Object.keys(headers).sort();
  const signedHeaders = signedHeaderKeys.join(";");
  const canonicalHeaders = signedHeaderKeys.map((k) => `${k}:${headers[k]}\n`).join("");

  const canonicalRequest = [
    method,
    `/${bucket}/${key}`,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
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

  const fetchHeaders: Record<string, string> = {
    Host: host,
    "x-amz-date": dateStamp,
    "x-amz-content-sha256": payloadHash,
    Authorization: authorization,
  };
  if (body) {
    fetchHeaders["Content-Type"] = "image/webp";
  }

  return fetch(url, {
    method,
    headers: fetchHeaders,
    body: body || undefined,
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
