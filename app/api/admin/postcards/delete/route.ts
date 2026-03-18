import { NextRequest, NextResponse } from "next/server";
import pool from "@/app/lib/db";

export async function POST(req: NextRequest) {
  const { id } = await req.json();
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  // Get scan image URLs for R2 cleanup
  const scans = await pool.query<{ id: number; image_url: string }>(
    `SELECT id, image_url FROM scans WHERE postcard_id = $1`,
    [id]
  );

  // Clear the postcards.scan_id FK first, then delete postcard, then delete scans
  await pool.query(`UPDATE postcards SET scan_id = NULL WHERE id = $1`, [id]);
  await pool.query(`UPDATE scans SET postcard_id = NULL WHERE postcard_id = $1`, [id]);
  await pool.query(`DELETE FROM postcards WHERE id = $1`, [id]);
  for (const scan of scans.rows) {
    await pool.query(`DELETE FROM scans WHERE id = $1`, [scan.id]);
  }

  // R2 cleanup (best effort)
  for (const scan of scans.rows) {
    try {
      await deleteFromR2(scan.image_url);
    } catch {
      // Non-critical
    }
  }

  return NextResponse.json({ ok: true });
}

async function deleteFromR2(key: string) {
  const accountId = process.env.R2_ACCOUNT_ID || "";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || "";
  const bucket = process.env.R2_BUCKET || "collectibot-scans";
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${bucket}/${key}`;

  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const shortDate = dateStamp.substring(0, 8);
  const credentialScope = `${shortDate}/auto/s3/aws4_request`;
  const enc = new TextEncoder();

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
    "x-amz-date": dateStamp,
  };
  const signedHeaderKeys = Object.keys(headers).sort();
  const signedHeaders = signedHeaderKeys.join(";");
  const canonicalHeaders = signedHeaderKeys.map(k => `${k}:${headers[k]}\n`).join("");

  const canonicalRequest = ["DELETE", `/${bucket}/${key}`, "", canonicalHeaders, signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const canonicalRequestHash = await sha256Hex(enc.encode(canonicalRequest));
  const stringToSign = ["AWS4-HMAC-SHA256", dateStamp, credentialScope, canonicalRequestHash].join("\n");

  const kDate = await hmacSha256(enc.encode(`AWS4${secretAccessKey}`), enc.encode(shortDate));
  const kRegion = await hmacSha256(kDate, enc.encode("auto"));
  const kService = await hmacSha256(kRegion, enc.encode("s3"));
  const kSigning = await hmacSha256(kService, enc.encode("aws4_request"));
  const signature = await hmacSha256Hex(kSigning, enc.encode(stringToSign));

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  await fetch(url, {
    method: "DELETE",
    headers: { Host: host, "x-amz-date": dateStamp, "x-amz-content-sha256": "UNSIGNED-PAYLOAD", Authorization: authorization },
  });
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data as any);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(key: any, data: any): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, data);
}

async function hmacSha256Hex(key: any, data: any): Promise<string> {
  const sig = await hmacSha256(key, data);
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}
