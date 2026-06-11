import { NextRequest, NextResponse } from "next/server";
import pool from "@/app/lib/db";

function stripPunctuation(s: string): string {
  return s.replace(/[^a-z0-9 ]/gi, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const issueNumber = req.nextUrl.searchParams.get("issue")?.trim() || null;
  let year = req.nextUrl.searchParams.get("year")?.trim() || null;

  // A typed 4-digit year (e.g. "Wolverine 1982" or "Wolverine (1982-") becomes
  // a ranking boost and is removed from the text tokens — the year isn't part
  // of any series name, so matching it against the name would find nothing.
  let qName = q;
  const yearInQ = q.match(/\b(?:18|19|20)\d{2}\b/);
  if (yearInQ) {
    if (!year) year = yearInQ[0];
    qName = q.replace(yearInQ[0], "");
  }

  // Every remaining typed word must appear somewhere in the series' searchable
  // text: the NAME, the PUBLISHER, the YEARS, or a VARIANT label (Direct,
  // Newsstand, etc.) — so "wolverine marvel", "wolverine direct", and
  // "wolverine newsstand" all work, not just the title.
  const tokens = stripPunctuation(qName).split(" ").filter((t) => t.length >= 2);
  if (tokens.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const params: (string | number | null)[] = [];

  // Only series that actually have this issue number (when one is provided).
  let issueFilter = "";
  if (issueNumber) {
    params.push(issueNumber);
    issueFilter = `AND (i.number = $${params.length} OR i.number LIKE '%(' || $${params.length} || ')%')`;
  }

  // Cheap inner pre-filter (keeps us from aggregating the whole table): the
  // series name OR publisher must contain the first typed word.
  params.push(`%${tokens[0]}%`);
  const prefilter = `$${params.length}`;

  // Outer per-token AND conditions against the combined haystack.
  const tokenConds = tokens
    .map((t) => {
      params.push(`%${t}%`);
      return `t.haystack LIKE $${params.length}`;
    })
    .join(" AND ");

  // Typed/known year → ranking boost (exact-year matches float to the top).
  params.push(year ? parseInt(year) : null);
  const yearParam = `$${params.length}`;

  const sql = `
    SELECT t.id, t.name, t.year_began, t.year_ended, t.publisher, t.issue_count,
           t.has_direct, t.has_newsstand, t.variants
    FROM (
      SELECT s.id, s.name, s.year_began, s.year_ended, p.name AS publisher, s.issue_count,
             bool_or(i.variant_name ILIKE '%direct%')    AS has_direct,
             bool_or(i.variant_name ILIKE '%newsstand%') AS has_newsstand,
             array_agg(DISTINCT i.variant_name) FILTER (WHERE i.variant_name IS NOT NULL) AS variants,
             LOWER(
               COALESCE(s.name, '') || ' ' || COALESCE(p.name, '') || ' ' ||
               COALESCE(s.year_began::text, '') || ' ' || COALESCE(s.year_ended::text, '') || ' ' ||
               COALESCE(STRING_AGG(DISTINCT COALESCE(i.variant_name, ''), ' '), '')
             ) AS haystack
      FROM series s
      LEFT JOIN publishers p ON s.publisher_id = p.id
      JOIN issues i ON i.series_id = s.id ${issueFilter}
      WHERE (REGEXP_REPLACE(LOWER(s.name), '[^a-z0-9 ]', '', 'g') ILIKE ${prefilter}
             OR LOWER(COALESCE(p.name, '')) ILIKE ${prefilter})
      GROUP BY s.id, s.name, s.year_began, s.year_ended, p.name, s.issue_count
    ) t
    WHERE ${tokenConds}
    ORDER BY
      CASE WHEN ${yearParam}::int IS NOT NULL
           AND t.year_began IS NOT NULL
           AND t.year_began <= ${yearParam}::int
           AND (t.year_ended IS NULL OR t.year_ended >= ${yearParam}::int)
           THEN 0 ELSE 1 END,
      t.year_began ASC NULLS LAST,
      t.issue_count DESC
    LIMIT 200`;

  const result = await pool.query(sql, params);
  return NextResponse.json({ results: result.rows });
}
