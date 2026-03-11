import { NextRequest, NextResponse } from "next/server";
import pool from "@/app/lib/db";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const result = await pool.query(
    `SELECT s.id, s.name, s.year_began, s.year_ended, p.name AS publisher,
            s.issue_count
     FROM series s
     LEFT JOIN publishers p ON s.publisher_id = p.id
     WHERE s.name ILIKE $1
     ORDER BY
       CASE WHEN s.name ILIKE $2 THEN 0 ELSE 1 END,
       s.year_began ASC
     LIMIT 20`,
    [`%${q}%`, `${q}%`]
  );

  return NextResponse.json({ results: result.rows });
}
