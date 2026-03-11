import { NextRequest, NextResponse } from "next/server";
import pool from "@/app/lib/db";

export async function GET(req: NextRequest) {
  const seriesId = req.nextUrl.searchParams.get("seriesId");
  if (!seriesId) {
    return NextResponse.json({ issues: [] });
  }

  const result = await pool.query(
    `SELECT id, number, publication_date, key_date
     FROM issues
     WHERE series_id = $1
     ORDER BY
       CASE WHEN number ~ '^[0-9]+$' THEN CAST(number AS INTEGER) ELSE 999999 END,
       number ASC
     LIMIT 500`,
    [seriesId]
  );

  return NextResponse.json({ issues: result.rows });
}
