import pool from "@/app/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import SeriesIssueList from "@/app/components/SeriesIssueList";

type Props = {
  params: Promise<{ id: string }>;
};

export const revalidate = 3600;

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const result = await pool.query<{ name: string; publisher_name: string | null; year_began: number | null; year_ended: number | null; issue_count: number | null }>(
    `SELECT s.name, p.name AS publisher_name, s.year_began, s.year_ended, s.issue_count
     FROM series s LEFT JOIN publishers p ON s.publisher_id = p.id WHERE s.id = $1`,
    [id]
  );
  if (result.rows.length === 0) return { title: "Series Not Found - Collectibot" };
  const s = result.rows[0];
  const years = s.year_began
    ? s.year_ended && s.year_ended !== s.year_began
      ? `${s.year_began}–${s.year_ended}`
      : `${s.year_began}`
    : "";
  const titleBits = [s.name];
  if (years) titleBits.push(`(${years})`);
  if (s.publisher_name) titleBits.push(`- ${s.publisher_name}`);
  const title = `${titleBits.join(" ")} - Collectibot`;

  const descBits = [s.name];
  if (s.publisher_name) descBits.push(`by ${s.publisher_name}`);
  if (years) descBits.push(years);
  if (s.issue_count && s.issue_count > 0) descBits.push(`${s.issue_count} issues`);
  return { title, description: `${descBits.join(", ")}. Browse issues, key issues, and creators.` };
}

type FeaturedCreator = {
  id: number;
  name: string;
  slug: string | null;
  credit_count: number;
};

type KeyIssueRow = {
  issue_id: number;
  number: string;
  publication_date: string | null;
  key_date: string | null;
  key_comment_1: string | null;
  key_comment_2: string | null;
  key_comment_3: string | null;
  has_scan: boolean;
};

export default async function SeriesPage({ params }: Props) {
  const { id } = await params;

  const seriesRes = await pool.query(
    `SELECT s.id, s.name, s.year_began, s.year_ended, s.format,
            s.issue_count, s.country, s.language,
            p.id AS publisher_id, p.name AS publisher_name
     FROM series s
     LEFT JOIN publishers p ON s.publisher_id = p.id
     WHERE s.id = $1`,
    [id]
  );

  if (seriesRes.rows.length === 0) return notFound();
  const series = seriesRes.rows[0];

  const issuesRes = await pool.query(
    `SELECT id, number, key_date, publication_date, on_sale_date, variant_name, price, variant_of_id
     FROM issues
     WHERE series_id = $1
     ORDER BY key_date ASC NULLS LAST, number ASC NULLS LAST`,
    [id]
  );

  const scannedRes = await pool.query(
    `SELECT sc.issue_id, sc.scan_type
     FROM scans sc JOIN issues i ON sc.issue_id = i.id
     WHERE i.series_id = $1`,
    [id]
  );

  const scannedIssues = new Set<string>();
  for (const row of scannedRes.rows) {
    if (row.scan_type === "front_cover") scannedIssues.add(String(row.issue_id));
  }

  const heroRes = await pool.query(
    `SELECT hero_issue_id FROM series_settings WHERE series_id = $1`,
    [id]
  );
  const heroIssueId = heroRes.rows.length > 0 ? String(heroRes.rows[0].hero_issue_id) : null;

  // Featured creators: top by credit count across this series' issues.
  const featuredCreatorsRes = await pool.query<FeaturedCreator>(
    `SELECT c.id, c.name, c.slug, count(*)::int AS credit_count
     FROM issue_credits ic
     JOIN issues i ON ic.issue_id = i.id
     JOIN creators c ON ic.creator_id = c.id
     WHERE i.series_id = $1
     GROUP BY c.id, c.name, c.slug
     ORDER BY credit_count DESC, c.name ASC
     LIMIT 20`,
    [id]
  );

  // Key issues for this series — only rows with a real key_comment_1 (filters
  // out the 60% of key_issues rows that are just art-credit annotations).
  // DISTINCT ON (i.id) dedupes the noisy CGC import data, which often has
  // 2-3 near-duplicate key_issues rows per issue (Conan #15 has three identical
  // "Elric of Melnibon? appearance." rows). Pick the row with the longest
  // key_comment_1 as tiebreaker so we keep the most informative copy.
  const keyIssuesRes = await pool.query<KeyIssueRow>(
    `SELECT * FROM (
       SELECT DISTINCT ON (i.id)
              ki.issue_id, i.number, i.publication_date, i.key_date,
              ki.key_comment_1, ki.key_comment_2, ki.key_comment_3,
              EXISTS(SELECT 1 FROM scans WHERE scans.issue_id = i.id AND scans.scan_type = 'front_cover') AS has_scan
       FROM key_issues ki
       JOIN issues i ON ki.issue_id = i.id
       WHERE i.series_id = $1 AND ki.key_comment_1 IS NOT NULL
       ORDER BY i.id, length(ki.key_comment_1) DESC, ki.id
     ) deduped
     ORDER BY key_date ASC NULLS LAST, number ASC
     LIMIT 50`,
    [id]
  );

  const issues = issuesRes.rows;
  const cacheBust = Date.now();
  const years = series.year_ended
    ? series.year_ended === series.year_began
      ? `${series.year_began}`
      : `${series.year_began}–${series.year_ended}`
    : `${series.year_began}–present`;

  // Fold the key-issue annotations into one flat, chronological issue list.
  // Each issue carries is_key + its comment inline (no separate "Key issues"
  // section, no decade grouping) — SeriesIssueList renders the single list and
  // the "Only show keys" toggle. issuesRes is already ordered chronologically
  // (key_date ASC NULLS LAST, number ASC), so undated issues fall to the end.
  const keyComments = new Map<string, string>();
  for (const k of keyIssuesRes.rows) {
    const c = [k.key_comment_1, k.key_comment_2, k.key_comment_3].filter(Boolean).join(" · ");
    keyComments.set(String(k.issue_id), c);
  }
  const issueList = issues.map((issue) => {
    const idStr = String(issue.id);
    return {
      id: issue.id as number,
      number: issue.number as string,
      variant_name: (issue.variant_name ?? null) as string | null,
      date: (issue.publication_date || issue.key_date || "") as string,
      on_sale_date:
        issue.on_sale_date && issue.on_sale_date !== issue.publication_date
          ? (issue.on_sale_date as string)
          : null,
      price: (issue.price ?? null) as string | null,
      has_scan: scannedIssues.has(idStr),
      is_key: keyComments.has(idStr),
      key_comment: keyComments.get(idStr) ?? null,
    };
  });

  const featuredCreators = featuredCreatorsRes.rows;
  const variantCount = issues.filter((i) => i.variant_of_id).length;

  return (
    <div style={{ maxWidth: 800, margin: "40px auto", padding: "0 20px", fontFamily: "system-ui" }}>
      <Link href="/" style={{ color: "#666", textDecoration: "none" }}>
        &larr; Back to search
      </Link>

      {/* Header */}
      <h1 style={{ marginTop: 16, marginBottom: 4 }}>{series.name}</h1>
      <p style={{ color: "#666", margin: "0 0 8px 0" }}>
        {[
          series.publisher_id ? (
            <Link key="pub" href={`/publisher/${series.publisher_id}`} style={{ color: "inherit", textDecoration: "none" }}>
              {series.publisher_name}
            </Link>
          ) : series.publisher_name,
          years,
          series.format,
        ]
          .filter(Boolean)
          .reduce<React.ReactNode[]>((acc, x, i) => {
            if (i > 0) acc.push(" · ");
            acc.push(x);
            return acc;
          }, [])}
      </p>
      <p style={{ color: "#999", margin: "0 0 24px 0" }}>
        {issues.length.toLocaleString()} issues · {scannedIssues.size} scanned
      </p>

      {/* Hero image */}
      {heroIssueId && scannedIssues.has(heroIssueId) && (() => {
        const heroIssue = issues.find((i) => String(i.id) === heroIssueId);
        return heroIssue ? (
          <Link href={`/issue/${heroIssue.id}`} style={{ textDecoration: "none" }}>
            <div style={{ marginBottom: 32, maxWidth: 200 }}>
              <img
                src={`/api/scans/image?issue=${heroIssue.id}&side=front&t=${cacheBust}`}
                alt={`${series.name} #${heroIssue.number}`}
                style={{ width: "100%", borderRadius: 6, border: "1px solid #333" }}
              />
            </div>
          </Link>
        ) : null;
      })()}

      {/* Structured details */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Details</h2>
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px", fontSize: 14, margin: 0 }}>
          {series.publisher_name && (
            <>
              <dt style={{ color: "#888" }}>Publisher</dt>
              <dd style={{ margin: 0 }}>
                {series.publisher_id ? (
                  <Link href={`/publisher/${series.publisher_id}`} style={{ color: "inherit" }}>
                    {series.publisher_name}
                  </Link>
                ) : (
                  series.publisher_name
                )}
              </dd>
            </>
          )}
          {series.year_began && (
            <>
              <dt style={{ color: "#888" }}>Years</dt>
              <dd style={{ margin: 0 }}>{years}</dd>
            </>
          )}
          {series.country && (
            <>
              <dt style={{ color: "#888" }}>Country</dt>
              <dd style={{ margin: 0 }}>{series.country}</dd>
            </>
          )}
          {series.language && (
            <>
              <dt style={{ color: "#888" }}>Language</dt>
              <dd style={{ margin: 0 }}>{series.language}</dd>
            </>
          )}
          {series.format && (
            <>
              <dt style={{ color: "#888" }}>Format</dt>
              <dd style={{ margin: 0 }}>{series.format}</dd>
            </>
          )}
          <dt style={{ color: "#888" }}>Issues</dt>
          <dd style={{ margin: 0 }}>{issues.length.toLocaleString()}</dd>
          {variantCount > 0 && (
            <>
              <dt style={{ color: "#888" }}>Variants</dt>
              <dd style={{ margin: 0 }}>{variantCount.toLocaleString()}</dd>
            </>
          )}
          {scannedIssues.size > 0 && (
            <>
              <dt style={{ color: "#888" }}>Cover scans</dt>
              <dd style={{ margin: 0 }}>{scannedIssues.size.toLocaleString()}</dd>
            </>
          )}
        </dl>
      </section>

      {/* Featured creators */}
      {featuredCreators.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Featured creators</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {featuredCreators.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/creator/${c.id}`}
                  style={{
                    display: "inline-block",
                    padding: "4px 10px",
                    border: "1px solid #333",
                    borderRadius: 4,
                    fontSize: 13,
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  {c.name}
                  <span style={{ color: "#888", marginLeft: 6 }}>{c.credit_count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* All issues — one flat list, keys marked inline, with an
          "Only show keys" toggle. Applies to every series page. */}
      <SeriesIssueList issues={issueList} cacheBust={cacheBust} />
    </div>
  );
}
