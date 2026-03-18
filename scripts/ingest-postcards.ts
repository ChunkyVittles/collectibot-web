import { readdir, readFile, mkdir, rename } from "fs/promises";
import { join, basename, dirname } from "path";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";
import postgres from "postgres";

// Load .dev.vars first (has remote DB), then .env.local (R2 keys etc), without overwriting
const __dirname = dirname(fileURLToPath(import.meta.url));
for (const envFile of [".dev.vars", ".env.local"]) {
  const envPath = join(__dirname, "..", envFile);
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
      const match = line.match(/^(\w+)=(.*)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2];
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const INBOX = process.env.POSTCARD_INBOX || join(process.env.HOME!, "Desktop/Postcards/inbox");
const DONE = process.env.POSTCARD_DONE || join(process.env.HOME!, "Desktop/Postcards/done");
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://collectibot:collectibot_cf_2024@172.234.24.65:5433/collectibot";
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "73dc075a05ec7910d286e84df20b0960";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET = process.env.R2_BUCKET || "collectibot-scans";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

const WATCH_MODE = process.argv.includes("--watch");

// ---------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------
function getDb() {
  return postgres(DATABASE_URL, { max: 1, idle_timeout: 0, connect_timeout: 10 });
}

// ---------------------------------------------------------------------------
// R2 helpers (AWS Sig V4)
// ---------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-explicit-any */
async function sha256Hex(data: any): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
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

async function uploadToR2(key: string, data: Uint8Array, contentType: string) {
  const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${R2_BUCKET}/${key}`;
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const shortDate = dateStamp.substring(0, 8);
  const credentialScope = `${shortDate}/auto/s3/aws4_request`;
  const payloadHash = await sha256Hex(data);
  const enc = new TextEncoder();

  const headers: Record<string, string> = {
    host,
    "content-type": contentType,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": dateStamp,
  };
  const signedHeaderKeys = Object.keys(headers).sort();
  const signedHeaders = signedHeaderKeys.join(";");
  const canonicalHeaders = signedHeaderKeys.map(k => `${k}:${headers[k]}\n`).join("");

  const canonicalRequest = ["PUT", `/${R2_BUCKET}/${key}`, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const canonicalRequestHash = await sha256Hex(enc.encode(canonicalRequest));
  const stringToSign = ["AWS4-HMAC-SHA256", dateStamp, credentialScope, canonicalRequestHash].join("\n");

  const kDate = await hmacSha256(enc.encode(`AWS4${R2_SECRET_ACCESS_KEY}`), enc.encode(shortDate));
  const kRegion = await hmacSha256(kDate, enc.encode("auto"));
  const kService = await hmacSha256(kRegion, enc.encode("s3"));
  const kSigning = await hmacSha256(kService, enc.encode("aws4_request"));
  const signature = await hmacSha256Hex(kSigning, enc.encode(stringToSign));

  const authorization = `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: { Host: host, "Content-Type": contentType, "x-amz-date": dateStamp, "x-amz-content-sha256": payloadHash, Authorization: authorization },
    body: data as unknown as BodyInit,
  });
  if (!res.ok) throw new Error(`R2 PUT ${key} failed: ${res.status}`);
}

async function deleteFromR2(key: string) {
  const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${R2_BUCKET}/${key}`;
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

  const canonicalRequest = ["DELETE", `/${R2_BUCKET}/${key}`, "", canonicalHeaders, signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const canonicalRequestHash = await sha256Hex(enc.encode(canonicalRequest));
  const stringToSign = ["AWS4-HMAC-SHA256", dateStamp, credentialScope, canonicalRequestHash].join("\n");

  const kDate = await hmacSha256(enc.encode(`AWS4${R2_SECRET_ACCESS_KEY}`), enc.encode(shortDate));
  const kRegion = await hmacSha256(kDate, enc.encode("auto"));
  const kService = await hmacSha256(kRegion, enc.encode("s3"));
  const kSigning = await hmacSha256(kService, enc.encode("aws4_request"));
  const signature = await hmacSha256Hex(kSigning, enc.encode(stringToSign));

  const authorization = `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  await fetch(url, {
    method: "DELETE",
    headers: { Host: host, "x-amz-date": dateStamp, "x-amz-content-sha256": "UNSIGNED-PAYLOAD", Authorization: authorization },
  });
}

// ---------------------------------------------------------------------------
// Claude Vision metadata extraction
// ---------------------------------------------------------------------------
interface PostcardMetadata {
  description: string;
  publisher: string | null;
  postmark_city: string | null;
  postmark_state: string | null;
  postmark_country: string | null;
  postmark_year: number | null;
  era: string | null;
  artist: string | null;
  subject_tags: string[];
}

async function extractMetadata(frontWebp: Buffer, backWebp: Buffer): Promise<PostcardMetadata> {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/webp", data: frontWebp.toString("base64") },
          },
          {
            type: "image",
            source: { type: "base64", media_type: "image/webp", data: backWebp.toString("base64") },
          },
          {
            type: "text",
            text: `You are analyzing scanned images of a vintage postcard. The first image is the front, the second is the back.

Extract the following metadata as JSON (no markdown, just raw JSON):
{
  "description": "Brief description of what the postcard depicts (the front image)",
  "publisher": "Publisher name if printed on the card, or null",
  "postmark_city": "City from postmark stamp, or null if not visible/readable",
  "postmark_state": "State/province from postmark, or null",
  "postmark_country": "Country from postmark (default 'United States' for US postmarks), or null",
  "postmark_year": 1923,  // Year from postmark as integer, or null
  "era": "One of: 'pioneer' (pre-1898), 'private mailing card' (1898-1901), 'undivided back' (1901-1907), 'divided back' (1907-1915), 'white border' (1915-1930), 'linen' (1930-1945), 'chrome' (1945-present), or null if uncertain",
  "artist": "Artist name if credited on the card, or null",
  "subject_tags": ["tag1", "tag2"]  // Descriptive tags for the postcard subject matter
}

Return ONLY valid JSON, no other text.`,
          },
        ],
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  try {
    return JSON.parse(text);
  } catch {
    console.error("Failed to parse Claude response:", text);
    return {
      description: text.slice(0, 500),
      publisher: null,
      postmark_city: null,
      postmark_state: null,
      postmark_country: null,
      postmark_year: null,
      era: null,
      artist: null,
      subject_tags: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

// ---------------------------------------------------------------------------
// Process a single postcard pair
// ---------------------------------------------------------------------------
async function processPostcard(id: string, frontPath: string, backPath: string) {
  console.log(`Processing postcard ${id}...`);

  // Read and convert to WebP
  const frontJpg = await readFile(frontPath);
  const backJpg = await readFile(backPath);
  const frontWebp = await sharp(frontJpg).rotate().webp({ quality: 85 }).toBuffer();
  const backWebp = await sharp(backJpg).rotate().webp({ quality: 85 }).toBuffer();

  console.log(`  Converted to WebP: front=${frontWebp.length} bytes, back=${backWebp.length} bytes`);

  // Extract metadata via Claude Vision
  console.log(`  Extracting metadata via Claude Vision...`);
  const metadata = await extractMetadata(frontWebp, backWebp);
  console.log(`  Description: ${metadata.description}`);
  console.log(`  Era: ${metadata.era}, Publisher: ${metadata.publisher}`);
  console.log(`  Postmark: ${metadata.postmark_city}, ${metadata.postmark_state} ${metadata.postmark_year || "?"}`);
  console.log(`  Tags: ${metadata.subject_tags.join(", ")}`);

  // Build SEO-friendly slug: description + location + tags + "postcard"
  const slugParts: string[] = [];
  if (metadata.description) slugParts.push(metadata.description);
  if (metadata.postmark_city && !metadata.description?.toLowerCase().includes(metadata.postmark_city.toLowerCase())) {
    slugParts.push(metadata.postmark_city);
  }
  if (metadata.postmark_state && !metadata.description?.toLowerCase().includes(metadata.postmark_state.toLowerCase())) {
    slugParts.push(metadata.postmark_state);
  }
  // Add tags not already covered by description
  for (const tag of metadata.subject_tags) {
    if (!slugParts.join(" ").toLowerCase().includes(tag.toLowerCase())) {
      slugParts.push(tag);
    }
  }
  slugParts.push("postcard");
  if (metadata.era) slugParts.push(metadata.era);
  const slug = slugify(slugParts.join(" "));
  const frontKey = `postcards/${slug}-front.webp`;
  const backKey = `postcards/${slug}-back.webp`;
  console.log(`  Uploading to R2: ${frontKey}, ${backKey}`);
  await uploadToR2(frontKey, new Uint8Array(frontWebp), "image/webp");
  await uploadToR2(backKey, new Uint8Array(backWebp), "image/webp");

  // Insert DB records
  const sql = getDb();
  try {
    // Insert front scan
    const frontScan = await sql`
      INSERT INTO scans (scan_type, image_url, contributor_id, rights_granted)
      VALUES ('postcard_front', ${frontKey}, 1, 'true')
      RETURNING id
    `;
    const frontScanId = frontScan[0].id;

    // Insert back scan
    const backScan = await sql`
      INSERT INTO scans (scan_type, image_url, contributor_id, rights_granted)
      VALUES ('postcard_back', ${backKey}, 1, 'true')
      RETURNING id
    `;
    const backScanId = backScan[0].id;

    // Insert postcard record (link to front scan)
    const postcard = await sql`
      INSERT INTO postcards (publisher, postmark_city, postmark_state, postmark_country, postmark_year, artist, subject_tags, description, era, scan_id)
      VALUES (${metadata.publisher}, ${metadata.postmark_city}, ${metadata.postmark_state}, ${metadata.postmark_country}, ${metadata.postmark_year}, ${metadata.artist}, ${metadata.subject_tags}, ${metadata.description}, ${metadata.era}, ${frontScanId})
      RETURNING id
    `;
    const postcardId = postcard[0].id;

    // Link scans back to postcard
    await sql`UPDATE scans SET postcard_id = ${postcardId} WHERE id IN (${frontScanId}, ${backScanId})`;

    console.log(`  DB: postcard_id=${postcardId}, front_scan_id=${frontScanId}, back_scan_id=${backScanId}`);
  } finally {
    await sql.end();
  }

  // Move processed files to done folder with SEO names
  await mkdir(DONE, { recursive: true });
  await rename(frontPath, join(DONE, `${slug}-front.jpg`));
  await rename(backPath, join(DONE, `${slug}-back.jpg`));
  console.log(`  Moved to ${DONE}`);
  console.log(`  Done!`);
}

// ---------------------------------------------------------------------------
// Scan inbox for pairs
// ---------------------------------------------------------------------------
async function scanInbox(): Promise<Array<{ id: string; front: string; back: string }>> {
  if (!existsSync(INBOX)) {
    console.log(`Inbox folder does not exist: ${INBOX}`);
    return [];
  }

  const files = await readdir(INBOX);
  const fronts = files.filter(f => f.match(/_1\.jpe?g$/i));
  const pairs: Array<{ id: string; front: string; back: string }> = [];

  for (const front of fronts) {
    const id = front.replace(/_1\.jpe?g$/i, "");
    const backFile = files.find(f => f.match(new RegExp(`^${escapeRegex(id)}_2\\.jpe?g$`, "i")));
    if (backFile) {
      pairs.push({ id, front: join(INBOX, front), back: join(INBOX, backFile) });
    } else {
      console.warn(`No back image found for ${front}, skipping`);
    }
  }

  return pairs;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Postcard Ingest`);
  console.log(`  Inbox: ${INBOX}`);
  console.log(`  Done:  ${DONE}`);
  console.log(`  Mode:  ${WATCH_MODE ? "watch" : "batch"}`);
  console.log();

  // Ensure directories exist
  await mkdir(INBOX, { recursive: true });
  await mkdir(DONE, { recursive: true });

  // Process existing files
  const pairs = await scanInbox();
  if (pairs.length > 0) {
    console.log(`Found ${pairs.length} postcard pair(s) to process`);
    for (const pair of pairs) {
      try {
        await processPostcard(pair.id, pair.front, pair.back);
      } catch (e) {
        console.error(`Error processing ${pair.id}:`, e);
      }
    }
  } else {
    console.log("No postcard pairs found in inbox");
  }

  // Watch mode
  if (WATCH_MODE) {
    console.log("\nWatching for new files...");
    const { watch } = await import("fs");
    const processing = new Set<string>();

    watch(INBOX, async (_event, filename) => {
      if (!filename || !filename.match(/_1\.jpe?g$/i)) return;
      const id = filename.replace(/_1\.jpe?g$/i, "");
      if (processing.has(id)) return;
      processing.add(id);

      // Brief delay to allow the back file to finish writing
      await new Promise(r => setTimeout(r, 2000));

      const pairs = await scanInbox();
      const pair = pairs.find(p => p.id === id);
      if (pair) {
        try {
          await processPostcard(pair.id, pair.front, pair.back);
        } catch (e) {
          console.error(`Error processing ${pair.id}:`, e);
        }
      }
      processing.delete(id);
    });
  }
}

main().catch(console.error);
