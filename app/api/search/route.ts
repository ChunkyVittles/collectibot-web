import { NextRequest, NextResponse } from "next/server";
import pool from "@/app/lib/db";

// Strip leading "The " and all punctuation for fuzzy comparison
const STRIP = `REGEXP_REPLACE(REGEXP_REPLACE(LOWER(s.name), '^the ', '', 'i'), '[^a-z0-9 ]', '', 'g')`;

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

function stripPunctuation(s: string): string {
  return s.replace(/[^a-z0-9 ]/gi, "").replace(/\s+/g, " ").trim();
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("q")?.trim();

  if (!raw || raw.length < 2) {
    return NextResponse.json({ results: [] });
  }

  // An issue number can arrive two ways:
  //   "Amazing Spider-Man #213" → explicit "#": strong intent → issue-only results.
  //   "Amazing Spider-Man 3"    → trailing bare number: ambiguous → show BOTH the
  //                               matching issue(s) AND the series (with the number
  //                               stripped off the name, so the base series shows).
  // A 4-digit trailing number is left as part of the name — it's usually a year
  // or part of the title (e.g. "Spider-Man 2099"); use "#" to force those.
  let issueNumber: string | null = null;
  let explicitHash = false;
  let seriesText = raw;

  const hashMatch = raw.match(/#\s*([^\s]+)/);
  if (hashMatch) {
    issueNumber = hashMatch[1].trim();
    explicitHash = true;
    seriesText = raw.replace(/#.*$/, "");
  } else {
    const trailMatch = raw.match(/^(.*\S)\s+(\d{1,3})$/);
    if (trailMatch && stripPunctuation(trailMatch[1]).length >= 2) {
      issueNumber = trailMatch[2];
      seriesText = trailMatch[1];
    }
  }

  // Strip leading "The " and punctuation from the series name for fuzzy compare.
  const seriesQ = seriesText.trim() || raw;
  const seriesQClean = stripPunctuation(seriesQ.replace(/^the\s+/i, ""));

  const seriesContains = `%${seriesQClean}%`;
  const seriesStartsWith = `${seriesQClean}%`;
  const contains = `%${raw}%`;
  const startsWith = `${raw}%`;

  try {
  // Issue-level results when a number is present. Matches every variant that
  // shares that series + number (direct, newsstand, Canadian, UK, …) — GCD
  // stores variants under the SAME number as their base issue, so one number
  // match returns base + all variants.
  let issueResults: Array<Record<string, unknown>> = [];
  if (issueNumber && seriesQClean.length >= 2) {
    const issues = await pool.query(
      `SELECT i.id, i.number, i.variant_name, i.variant_of_id,
              s.name AS series_name, s.year_began, s.year_ended,
              p.name AS publisher
       FROM issues i
       JOIN series s ON i.series_id = s.id
       LEFT JOIN publishers p ON s.publisher_id = p.id
       WHERE ${STRIP} ILIKE $3
         AND (i.number = $4 OR i.number LIKE '%(' || $4 || ')%')
       ORDER BY ${SERIES_RANK_SQL},
                s.year_began ASC NULLS LAST, s.name ASC,
                (i.variant_of_id IS NOT NULL), i.variant_name ASC NULLS FIRST, i.id ASC
       LIMIT 100`,
      [seriesQClean, seriesStartsWith, seriesContains, issueNumber]
    );
    issueResults = issues.rows.map((r) => ({ type: "Issue" as const, ...r }));
  }

  // Explicit "#<number>" → the user clearly wants that issue: return issues only.
  if (explicitHash) {
    return NextResponse.json({ results: issueResults });
  }

  const [series, creators, characters] = await Promise.all([
    pool.query(
      `SELECT s.id, s.name, s.year_began, s.year_ended, s.issue_count, p.name AS publisher
       FROM series s
       LEFT JOIN publishers p ON s.publisher_id = p.id
       WHERE ${STRIP} ILIKE $3
       ORDER BY ${SERIES_RANK_SQL}, s.year_began ASC NULLS LAST, s.name ASC`,
      [seriesQClean, seriesStartsWith, seriesContains]
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
    ...issueResults,
    ...series.rows.map((r) => ({ type: "Series" as const, ...r })),
    ...creators.rows.map((r) => ({ type: "Creator" as const, ...r })),
    ...characters.rows.map((r) => ({ type: "Character" as const, ...r })),
  ];

  return NextResponse.json({ results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("Search API error:", message, stack);
    return NextResponse.json(
      { error: message, dbUrl: process.env.DATABASE_URL ? "set" : "NOT SET" },
      { status: 500 }
    );
  }
}
