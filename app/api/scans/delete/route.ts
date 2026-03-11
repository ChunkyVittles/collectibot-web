import { NextRequest, NextResponse } from "next/server";
import pool from "@/app/lib/db";

export async function DELETE(req: NextRequest) {
  const { issueId } = await req.json();

  if (!issueId) {
    return NextResponse.json({ error: "Missing issueId" }, { status: 400 });
  }

  // Get all scan URLs for this issue so we can delete from R2
  const scansRes = await pool.query(
    `SELECT id, image_url FROM scans WHERE issue_id = $1`,
    [issueId]
  );

  if (scansRes.rows.length === 0) {
    return NextResponse.json({ error: "No scans found" }, { status: 404 });
  }

  // Delete from R2
  const accountId = process.env.R2_ACCOUNT_ID || "73dc075a05ec7910d286e84df20b0960";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || "";
  const secretKey = process.env.R2_SECRET_ACCESS_KEY || "";
  const bucket = process.env.R2_BUCKET || "collectibot-scans";
  const host = `${accountId}.r2.cloudflarestorage.com`;

  for (const scan of scansRes.rows) {
    let key = scan.image_url as string;
    const r2DevMatch = key.match(/r2\.dev\/(.+)$/);
    if (r2DevMatch) key = r2DevMatch[1];

    try {
      const url = `https://${host}/${bucket}/${key}`;
      await signedR2Request("DELETE", url, bucket, key, accessKeyId, secretKey, host);
    } catch (e) {
      console.error(`Failed to delete R2 object ${key}:`, e);
    }
  }

  // Delete from database
  await pool.query(`DELETE FROM scans WHERE issue_id = $1`, [issueId]);

  return NextResponse.json({
    deleted: scansRes.rows.length,
    issueId,
  });
}

async function signedR2Request(
  method: string,
  _url: string,
  bucket: string,
  key: string,
  accessKeyId: string,
  secretAccessKey: string,
  host: string,
): Promise<Response> {
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
    method,
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
    method,
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
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function hmacSha256(key: any, data: any): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, data);
}

async function hmacSha256Hex(key: any, data: any): Promise<string> {
  const sig = await hmacSha256(key, data);
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
