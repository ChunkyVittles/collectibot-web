import { NextResponse } from "next/server";
import pool from "@/app/lib/db";

export async function GET() {
  try {
    const result = await pool.query(
      `SELECT s.issue_id, s.uploaded_at,
              i.number AS issue_number,
              sr.name AS series_name, sr.id AS series_id
       FROM scans s
       JOIN issues i ON s.issue_id = i.id
       JOIN series sr ON i.series_id = sr.id
       WHERE s.scan_type = 'front_cover'
       ORDER BY s.uploaded_at DESC
       LIMIT 20`
    );

    return NextResponse.json(result.rows);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
