import { NextRequest, NextResponse } from "next/server";
import pool from "@/app/lib/db";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const issueId = formData.get("issue_id") as string | null;
  const side = formData.get("side") as string | null; // "front" or "back"

  if (!file || !issueId || !side) {
    return NextResponse.json(
      { error: "Missing file, issue_id, or side" },
      { status: 400 }
    );
  }

  if (side !== "front" && side !== "back") {
    return NextResponse.json(
      { error: "side must be 'front' or 'back'" },
      { status: 400 }
    );
  }

  // Look up series slug for the R2 path
  const issueRes = await pool.query(
    `SELECT i.id, s.name AS series_name
     FROM issues i
     JOIN series s ON i.series_id = s.id
     WHERE i.id = $1`,
    [issueId]
  );

  if (issueRes.rows.length === 0) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  const seriesName = issueRes.rows[0].series_name as string;
  const seriesSlug = slugify(seriesName);

  // Read the uploaded file
  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  // Determine content type — we expect webp from client-side conversion
  const contentType = file.type || "image/webp";
  const suffix = side === "front" ? "F" : "B";
  const r2Key = `comics/${seriesSlug}/${issueId}_${suffix}.webp`;

  const accountId = process.env.R2_ACCOUNT_ID || "73dc075a05ec7910d286e84df20b0960";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || "";
  const secretKey = process.env.R2_SECRET_ACCESS_KEY || "";
  const bucket = process.env.R2_BUCKET || "collectibot-scans";

  try {
    await uploadToR2(bucket, r2Key, data, contentType, accessKeyId, secretKey, accountId);
  } catch (e) {
    return NextResponse.json(
      { error: `R2 upload failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }

  // Upsert scan record
  const scanType = side === "front" ? "front_cover" : "back_cover";
  const existing = await pool.query(
    `SELECT id FROM scans WHERE issue_id = $1 AND scan_type = $2`,
    [issueId, scanType]
  );

  if (existing.rows.length > 0) {
    await pool.query(
      `UPDATE scans SET image_url = $1, uploaded_at = NOW() WHERE issue_id = $2 AND scan_type = $3`,
      [r2Key, issueId, scanType]
    );
  } else {
    await pool.query(
      `INSERT INTO scans (issue_id, scan_type, image_url, contributor_id, rights_granted)
       VALUES ($1, $2, $3, 1, 'true')`,
      [issueId, scanType, r2Key]
    );
  }

  return NextResponse.json({ ok: true, key: r2Key });
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function uploadToR2(
  bucket: string,
  key: string,
  data: Uint8Array,
  contentType: string,
  accessKeyId: string,
  secretAccessKey: string,
  accountId: string,
) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${bucket}/${key}`;

  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const shortDate = dateStamp.substring(0, 8);
  const region = "auto";
  const service = "s3";
  const credentialScope = `${shortDate}/${region}/${service}/aws4_request`;

  const payloadHash = await sha256Hex(data);

  const headers: Record<string, string> = {
    host,
    "content-type": contentType,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": dateStamp,
  };

  const signedHeaderKeys = Object.keys(headers).sort();
  const signedHeaders = signedHeaderKeys.join(";");
  const canonicalHeaders = signedHeaderKeys.map((k) => `${k}:${headers[k]}\n`).join("");

  const canonicalRequest = [
    "PUT",
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

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Host: host,
      "Content-Type": contentType,
      "x-amz-date": dateStamp,
      "x-amz-content-sha256": payloadHash,
      Authorization: authorization,
    },
    body: data,
  });

  if (!res.ok) {
    throw new Error(`PUT ${key} failed: ${res.status}`);
  }
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
