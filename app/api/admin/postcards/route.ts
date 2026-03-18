import { NextResponse } from "next/server";
import pool from "@/app/lib/db";

export async function GET() {
  const result = await pool.query<{
    id: number;
    publisher: string | null;
    postmark_city: string | null;
    postmark_state: string | null;
    postmark_country: string | null;
    postmark_year: number | null;
    artist: string | null;
    subject_tags: string[] | null;
    description: string | null;
    era: string | null;
    scan_id: number | null;
    front_image: string | null;
    back_image: string | null;
  }>(
    `SELECT p.*,
            (SELECT s.image_url FROM scans s WHERE s.postcard_id = p.id AND s.scan_type = 'postcard_front' LIMIT 1) AS front_image,
            (SELECT s.image_url FROM scans s WHERE s.postcard_id = p.id AND s.scan_type = 'postcard_back' LIMIT 1) AS back_image
     FROM postcards p
     ORDER BY p.id DESC`
  );

  return NextResponse.json({ postcards: result.rows });
}
