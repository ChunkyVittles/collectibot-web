import { NextRequest, NextResponse } from "next/server";
import pool from "@/app/lib/db";

// Strip leading "The " for comparison
const STRIP = `REGEXP_REPLACE(LOWER(s.name), '^the ', '', 'i')`;

const SERIES_RANK_SQL = `
  CASE
    WHEN ${STRIP} = LOWER($1) THEN 0
    WHEN ${STRIP} LIKE LOWER($2) THEN 1
    ELSE 2
  END
`;

const RANK_SQL = `
  CASE
    WHEN LOWER(name) = LOWER($1) THEN 0
    WHEN LOWER(name) LIKE LOWER($2) THEN 1
    ELSE 2
  END
`;

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("q")?.trim();

  if (!raw || raw.length < 2) {
    return NextResponse.json({ results: [] });
  }

  // Strip "#..." suffix for series search (e.g. "Amazing Spider-Man #1" → "Amazing Spider-Man")
  const seriesQ = raw.replace(/#.*$/, "").trim() || raw;
  // Strip leading "The " from the query too
  const seriesQNoArticle = seriesQ.replace(/^the\s+/i, "");

  const seriesContains = `%${seriesQNoArticle}%`;
  const seriesStartsWith = `${seriesQNoArticle}%`;
  const contains = `%${raw}%`;
  const startsWith = `${raw}%`;

  const [series, creators, characters] = await Promise.all([
    pool.query(
      `SELECT s.id, s.name, s.year_began, s.year_ended, p.name AS publisher
       FROM series s
       LEFT JOIN publishers p ON s.publisher_id = p.id
       WHERE ${STRIP} ILIKE $3
       ORDER BY ${SERIES_RANK_SQL}, s.year_began ASC NULLS LAST, s.name ASC`,
      [seriesQNoArticle, seriesStartsWith, seriesContains]
    ),
    pool.query(
      `SELECT id, name, slug, birth_year
       FROM creators
       WHERE name ILIKE $3
       ORDER BY ${RANK_SQL}, name
       LIMIT 10`,
      [raw, startsWith, contains]
    ),
    pool.query(
      `SELECT id, name, slug, universe, year_first_published
       FROM characters
       WHERE name ILIKE $3
       ORDER BY ${RANK_SQL}, name
       LIMIT 10`,
      [raw, startsWith, contains]
    ),
  ]);

  const results = [
    ...series.rows.map((r) => ({ type: "Series" as const, ...r })),
    ...creators.rows.map((r) => ({ type: "Creator" as const, ...r })),
    ...characters.rows.map((r) => ({ type: "Character" as const, ...r })),
  ];

  return NextResponse.json({ results });
}
