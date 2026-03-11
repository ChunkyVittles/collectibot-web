import { NextResponse } from "next/server";
import pool from "@/app/lib/db";

export const runtime = "edge";

export async function GET() {
  const result = await pool.query(
    `SELECT DISTINCT ON (s.issue_id)
       s.issue_id, s.uploaded_at,
       i.number AS issue_number,
       sr.name AS series_name, sr.id AS series_id
     FROM scans s
     JOIN issues i ON s.issue_id = i.id
     JOIN series sr ON i.series_id = sr.id
     WHERE s.scan_type = 'front_cover'
     ORDER BY s.issue_id, s.uploaded_at DESC`
  );

  // Sort by most recent upload first, limit to 20
  const sorted = result.rows
    .sort((a: any, b: any) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime())
    .slice(0, 20);

  return NextResponse.json(sorted);
}
