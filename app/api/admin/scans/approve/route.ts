import { NextRequest, NextResponse } from "next/server";
import pool from "@/app/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { pending_id, issue_id, series_slug } = body;

  if (!pending_id || !issue_id || !series_slug) {
    return NextResponse.json(
      { error: "Missing pending_id, issue_id, or series_slug" },
      { status: 400 }
    );
  }

  // Get the pending scan record
  const pending = await pool.query(
    `SELECT * FROM pending_scans WHERE id = $1`,
    [pending_id]
  );

  if (pending.rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const scan = pending.rows[0];

  // R2 config
  const accountId = process.env.R2_ACCOUNT_ID || "73dc075a05ec7910d286e84df20b0960";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || "";
  const secretKey = process.env.R2_SECRET_ACCESS_KEY || "";
  const bucket = process.env.R2_BUCKET || "collectibot-scans";

  // Copy pending images to final comics/ path in R2
  const frontSrc = scan.front_image_path; // e.g. "pending/foo-front.webp"
  const backSrc = scan.back_image_path;   // e.g. "pending/foo-back.webp"
  const frontDst = `comics/${series_slug}/${issue_id}_F.webp`;
  const backDst = `comics/${series_slug}/${issue_id}_B.webp`;

  try {
    // Copy front cover
    await copyR2Object(bucket, frontSrc, frontDst, accessKeyId, secretKey, accountId);
    // Copy back cover
    await copyR2Object(bucket, backSrc, backDst, accessKeyId, secretKey, accountId);
  } catch (e) {
    return NextResponse.json(
      { error: `R2 copy failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }

  // Delete any existing scans for this issue (avoid duplicates)
  await pool.query(`DELETE FROM scans WHERE issue_id = $1`, [issue_id]);

  // Insert into scans table (front + back)
  await pool.query(
    `INSERT INTO scans (issue_id, scan_type, image_url, contributor_id, rights_granted)
     VALUES ($1, 'front_cover', $2, 1, 'true')`,
    [issue_id, frontDst]
  );

  await pool.query(
    `INSERT INTO scans (issue_id, scan_type, image_url, contributor_id, rights_granted)
     VALUES ($1, 'back_cover', $2, 1, 'true')`,
    [issue_id, backDst]
  );

  // Delete from pending_scans
  await pool.query(`DELETE FROM pending_scans WHERE id = $1`, [pending_id]);

  // Clean up pending images from R2 (best effort)
  try {
    await deleteR2Object(bucket, frontSrc, accessKeyId, secretKey, accountId);
    await deleteR2Object(bucket, backSrc, accessKeyId, secretKey, accountId);
  } catch {
    // Non-critical, ignore
  }

  return NextResponse.json({
    ok: true,
    issue_id,
    series_slug,
    front_url: frontDst,
    back_url: backDst,
  });
}

// R2 S3 copy: GET source, PUT to destination
async function copyR2Object(
  bucket: string,
  srcKey: string,
  dstKey: string,
  accessKeyId: string,
  secretKey: string,
  accountId: string,
) {
  // Fetch source object
  const srcResponse = await signedR2Request("GET", bucket, srcKey, accessKeyId, secretKey, accountId);
  if (!srcResponse.ok) {
    throw new Error(`Failed to read ${srcKey}: ${srcResponse.status}`);
  }
  const data = await srcResponse.arrayBuffer();

  // Put to destination
  const putResponse = await signedR2Request("PUT", bucket, dstKey, accessKeyId, secretKey, accountId, data);
  if (!putResponse.ok) {
    throw new Error(`Failed to write ${dstKey}: ${putResponse.status}`);
  }
}

async function deleteR2Object(
  bucket: string,
  key: string,
  accessKeyId: string,
  secretKey: string,
  accountId: string,
) {
  await signedR2Request("DELETE", bucket, key, accessKeyId, secretKey, accountId);
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
