import { NextRequest, NextResponse } from "next/server";
import pool from "@/app/lib/db";

export async function POST(req: NextRequest) {
  const { issueId } = await req.json();

  if (!issueId) {
    return NextResponse.json({ error: "Missing issueId" }, { status: 400 });
  }

  // Get current scans for this issue
  const scansRes = await pool.query(
    `SELECT id, scan_type, image_url FROM scans WHERE issue_id = $1`,
    [issueId]
  );

  const front = scansRes.rows.find((r) => r.scan_type === "front_cover");
  const back = scansRes.rows.find((r) => r.scan_type === "back_cover");

  if (!front || !back) {
    return NextResponse.json(
      { error: "Need both front and back scans to swap" },
      { status: 400 }
    );
  }

  // Swap scan_type and image_url in the database
  // Step 1: Rename R2 keys (front→temp, back→front, temp→back)
  const accountId = process.env.R2_ACCOUNT_ID || "73dc075a05ec7910d286e84df20b0960";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || "";
  const secretKey = process.env.R2_SECRET_ACCESS_KEY || "";
  const bucket = process.env.R2_BUCKET || "collectibot-scans";
  const host = `${accountId}.r2.cloudflarestorage.com`;

  // Extract R2 keys from URLs
  function extractKey(url: string): string {
    const m = url.match(/r2\.dev\/(.+)$/);
    return m ? m[1] : url;
  }

  const frontKey = extractKey(front.image_url);
  const backKey = extractKey(back.image_url);

  // To swap R2 objects: copy front→temp, copy back→front key, copy temp→back key, delete temp
  // But simpler: just swap the DB records (scan_type and image_url) without touching R2
  // Since the image_url already points to the correct file, we just swap which row is "front" vs "back"

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Swap scan_type
    await client.query(
      `UPDATE scans SET scan_type = 'back_cover' WHERE id = $1`,
      [front.id]
    );
    await client.query(
      `UPDATE scans SET scan_type = 'front_cover' WHERE id = $1`,
      [back.id]
    );

    // Swap image_url so the URLs match the new scan_type
    await client.query(
      `UPDATE scans SET image_url = $1 WHERE id = $2`,
      [back.image_url, front.id]
    );
    await client.query(
      `UPDATE scans SET image_url = $1 WHERE id = $2`,
      [front.image_url, back.id]
    );

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Swap failed:", e);
    return NextResponse.json({ error: "Swap failed" }, { status: 500 });
  } finally {
    client.release();
  }

  // Now rename the actual R2 files to match
  // front_F.webp → temp, back_B.webp → front_F.webp, temp → back_B.webp
  try {
    const tempKey = frontKey.replace("_F.webp", "_TEMP.webp");

    // Copy front → temp
    await copyR2Object(bucket, frontKey, tempKey, accessKeyId, secretKey, host);
    // Copy back → front
    await copyR2Object(bucket, backKey, frontKey, accessKeyId, secretKey, host);
    // Copy temp → back
    await copyR2Object(bucket, tempKey, backKey, accessKeyId, secretKey, host);
    // Delete temp
    await signedR2Request("DELETE", "", bucket, tempKey, accessKeyId, secretKey, host);
  } catch (e) {
    console.error("R2 rename failed (DB already swapped):", e);
    // DB is already swapped — R2 files may be stale but will still serve
  }

  return NextResponse.json({ success: true, issueId });
}

async function copyR2Object(
  bucket: string,
  sourceKey: string,
  destKey: string,
  accessKeyId: string,
  secretAccessKey: string,
  host: string,
): Promise<void> {
  // GET the source
  const getUrl = `https://${host}/${bucket}/${sourceKey}`;
  const getResp = await signedR2Request("GET", getUrl, bucket, sourceKey, accessKeyId, secretAccessKey, host);
  if (!getResp.ok) throw new Error(`GET ${sourceKey} failed: ${getResp.status}`);
  const body = await getResp.arrayBuffer();

  // PUT to destination
  const putUrl = `https://${host}/${bucket}/${destKey}`;
  await signedR2PutRequest(putUrl, bucket, destKey, accessKeyId, secretAccessKey, host, new Uint8Array(body));
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

async function signedR2PutRequest(
  _url: string,
  bucket: string,
  key: string,
  accessKeyId: string,
  secretAccessKey: string,
  host: string,
  body: Uint8Array,
): Promise<Response> {
  const url = `https://${host}/${bucket}/${key}`;
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const shortDate = dateStamp.substring(0, 8);
  const region = "auto";
  const service = "s3";
  const credentialScope = `${shortDate}/${region}/${service}/aws4_request`;

  const bodyHash = await sha256Hex(body);
  const canonicalHeaders = `content-type:image/webp\nhost:${host}\nx-amz-content-sha256:${bodyHash}\nx-amz-date:${dateStamp}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "PUT",
    `/${bucket}/${key}`,
    "",
    canonicalHeaders,
    signedHeaders,
    bodyHash,
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
    method: "PUT",
    headers: {
      Host: host,
      "Content-Type": "image/webp",
      "x-amz-date": dateStamp,
      "x-amz-content-sha256": bodyHash,
      Authorization: authorization,
    },
    body,
  });
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data as ArrayBuffer);
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
