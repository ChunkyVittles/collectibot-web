import { NextRequest, NextResponse } from "next/server";
import pool from "@/app/lib/db";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const issueNumber = req.nextUrl.searchParams.get("issue")?.trim() || null;
  const year = req.nextUrl.searchParams.get("year")?.trim() || null;

  if (issueNumber) {
    // Smart search: only return series that actually have this issue number
    const result = await pool.query(
      `SELECT s.id, s.name, s.year_began, s.year_ended, p.name AS publisher,
              s.issue_count,
              bool_or(i.variant_name ILIKE '%direct%') AS has_direct,
              bool_or(i.variant_name ILIKE '%newsstand%') AS has_newsstand,
              array_agg(DISTINCT i.variant_name) FILTER (WHERE i.variant_name IS NOT NULL) AS variants
       FROM series s
       LEFT JOIN publishers p ON s.publisher_id = p.id
       JOIN issues i ON i.series_id = s.id AND i.number = $3
       WHERE s.name ILIKE $1
       GROUP BY s.id, s.name, s.year_began, s.year_ended, p.name, s.issue_count
       ORDER BY
         CASE WHEN s.name ILIKE $2 THEN 0 ELSE 1 END,
         CASE WHEN $4::int IS NOT NULL
              AND s.year_began IS NOT NULL
              AND s.year_began <= $4::int
              AND (s.year_ended IS NULL OR s.year_ended >= $4::int)
              THEN 0 ELSE 1 END,
         s.issue_count DESC,
         s.year_began ASC
       LIMIT 200`,
      [`%${q}%`, `${q}%`, issueNumber, year ? parseInt(year) : null]
    );

    return NextResponse.json({ results: result.rows });
  }

  // Fallback: name-only search (no issue number provided)
  const result = await pool.query(
    `SELECT s.id, s.name, s.year_began, s.year_ended, p.name AS publisher,
            s.issue_count
     FROM series s
     LEFT JOIN publishers p ON s.publisher_id = p.id
     WHERE s.name ILIKE $1
     ORDER BY
       CASE WHEN s.name ILIKE $2 THEN 0 ELSE 1 END,
       s.issue_count DESC,
       s.year_began ASC
     LIMIT 200`,
    [`%${q}%`, `${q}%`]
  );

  return NextResponse.json({ results: result.rows });
}
