import { NextResponse } from "next/server";
import pool from "@/app/lib/db";

export async function GET() {
  try {
    // Get matched scans
    const matched = await pool.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (s.issue_id)
                s.issue_id, s.uploaded_at,
                i.number AS issue_number,
                sr.name AS series_name, sr.id AS series_id,
                'matched' AS status
         FROM scans s
         JOIN issues i ON s.issue_id = i.id
         JOIN series sr ON i.series_id = sr.id
         WHERE s.scan_type = 'front_cover'
         ORDER BY s.issue_id, s.uploaded_at DESC
       ) t ORDER BY t.uploaded_at DESC LIMIT 10`
    );

    // Get pending/review scans
    const pending = await pool.query(
      `SELECT id AS pending_id, front_image_path,
              extracted_title AS series_name,
              extracted_issue AS issue_number,
              created_at AS uploaded_at,
              'pending' AS status
       FROM pending_scans
       ORDER BY created_at DESC
       LIMIT 10`
    );

    // Merge and sort by date
    const all = [...matched.rows, ...pending.rows]
      .sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime())
      .slice(0, 10);

    return NextResponse.json(all);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
