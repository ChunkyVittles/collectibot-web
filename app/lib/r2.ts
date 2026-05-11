export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export function getR2Config(): R2Config {
  return {
    accountId: process.env.R2_ACCOUNT_ID || "73dc075a05ec7910d286e84df20b0960",
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    bucket: process.env.R2_BUCKET || "collectibot-scans",
  };
}

export async function copyR2Object(cfg: R2Config, srcKey: string, dstKey: string) {
  const srcResponse = await signedR2Request("GET", cfg, srcKey);
  if (!srcResponse.ok) {
    throw new Error(`Failed to read ${srcKey}: ${srcResponse.status}`);
  }
  const data = await srcResponse.arrayBuffer();
  const putResponse = await signedR2Request("PUT", cfg, dstKey, data);
  if (!putResponse.ok) {
    throw new Error(`Failed to write ${dstKey}: ${putResponse.status}`);
  }
}

export async function deleteR2Object(cfg: R2Config, key: string) {
  const res = await signedR2Request("DELETE", cfg, key);
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete ${key}: ${res.status}`);
  }
}

async function signedR2Request(
  method: string,
  cfg: R2Config,
  key: string,
  body?: ArrayBuffer,
): Promise<Response> {
  const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${cfg.bucket}/${key}`;

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
    `/${cfg.bucket}/${key}`,
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

  const kDate = await hmacSha256(encoder.encode(`AWS4${cfg.secretAccessKey}`), encoder.encode(shortDate));
  const kRegion = await hmacSha256(kDate, encoder.encode(region));
  const kService = await hmacSha256(kRegion, encoder.encode(service));
  const kSigning = await hmacSha256(kService, encoder.encode("aws4_request"));

  const signature = await hmacSha256Hex(kSigning, encoder.encode(stringToSign));

  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

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
