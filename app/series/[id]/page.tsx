import pool from "@/app/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const result = await pool.query<{ name: string; publisher_name: string | null; year_began: number | null }>(
    `SELECT s.name, p.name AS publisher_name, s.year_began
     FROM series s LEFT JOIN publishers p ON s.publisher_id = p.id WHERE s.id = $1`,
    [id]
  );
  if (result.rows.length === 0) return { title: "Series Not Found" };
  const s = result.rows[0];
  return {
    title: `${s.name}${s.publisher_name ? ` - ${s.publisher_name}` : ""} - Collectibot`,
    description: `${s.name}${s.publisher_name ? ` published by ${s.publisher_name}` : ""}${s.year_began ? `, ${s.year_began}` : ""}. Browse all issues with cover scans.`,
  };
}

function decadeLabel(year: number): string {
  const d = Math.floor(year / 10) * 10;
  return `${d}s`;
}

function yearFromKeyDate(kd: string | null): number | null {
  if (!kd || kd.length < 4) return null;
  const y = parseInt(kd.substring(0, 4), 10);
  return isNaN(y) ? null : y;
}

export default async function SeriesPage({ params }: Props) {
  const { id } = await params;

  const seriesRes = await pool.query(
    `SELECT s.id, s.name, s.year_began, s.year_ended, s.format,
            s.issue_count, s.country, s.language,
            p.name AS publisher_name
     FROM series s
     LEFT JOIN publishers p ON s.publisher_id = p.id
     WHERE s.id = $1`,
    [id]
  );

  if (seriesRes.rows.length === 0) return notFound();
  const series = seriesRes.rows[0];

  const issuesRes = await pool.query(
    `SELECT id, number, key_date, publication_date, variant_name, price
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

  const issues = issuesRes.rows;
  const cacheBust = Date.now();
  const years = series.year_ended
    ? `${series.year_began}–${series.year_ended}`
    : `${series.year_began}–present`;

  // Group issues by decade
  const decades = new Map<string, typeof issues>();
  const undated: typeof issues = [];
  for (const issue of issues) {
    const year = yearFromKeyDate(issue.key_date || issue.publication_date);
    if (!year) {
      undated.push(issue);
    } else {
      const label = decadeLabel(year);
      if (!decades.has(label)) decades.set(label, []);
      decades.get(label)!.push(issue);
    }
  }
  const sortedDecades = Array.from(decades.keys()).sort();

  return (
    <div style={{ maxWidth: 800, margin: "40px auto", padding: "0 20px", fontFamily: "system-ui" }}>
      <Link href="/" style={{ color: "#666", textDecoration: "none" }}>
        &larr; Back to search
      </Link>

      {/* Header */}
      <h1 style={{ marginTop: 16, marginBottom: 4 }}>{series.name}</h1>
      <p style={{ color: "#666", margin: "0 0 8px 0" }}>
        {[series.publisher_name, years, series.format].filter(Boolean).join(" · ")}
      </p>
      <p style={{ color: "#999", margin: "0 0 16px 0" }}>
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

      {/* Decade-grouped timeline */}
      {sortedDecades.map((decade) => {
        const items = decades.get(decade)!;
        return (
          <div key={decade} style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 20, borderBottom: "2px solid #333", paddingBottom: 4, marginBottom: 12 }}>
              {decade}
              <span style={{ fontWeight: 400, fontSize: 14, color: "#999", marginLeft: 8 }}>
                ({items.length.toLocaleString()})
              </span>
            </h2>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                  <th style={{ padding: "4px 8px 4px 0", width: 48 }}></th>
                  <th style={{ padding: "4px 8px", width: 60 }}>#</th>
                  <th style={{ padding: "4px 8px" }}>Date</th>
                  <th style={{ padding: "4px 8px", width: 80 }}>Price</th>
                </tr>
              </thead>
              <tbody>
                {items.map((issue) => (
                  <tr key={issue.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "4px 8px 4px 0" }}>
                      <Link href={`/issue/${issue.id}`} style={{ display: "block", textDecoration: "none" }}>
                        {scannedIssues.has(String(issue.id)) ? (
                          <img
                            src={`/api/scans/image?issue=${issue.id}&side=front&t=${cacheBust}`}
                            alt=""
                            style={{ width: 32, height: 48, objectFit: "cover", borderRadius: 2, verticalAlign: "middle" }}
                          />
                        ) : (
                          <div style={{ width: 32, height: 48, background: "#1a1a1a", borderRadius: 2, border: "1px solid #333" }} />
                        )}
                      </Link>
                    </td>
                    <td style={{ padding: "4px 8px", fontWeight: 600 }}>
                      <Link href={`/issue/${issue.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                        {issue.number}
                        {issue.variant_name && (
                          <span style={{ fontWeight: 400, color: "#999", fontSize: 12 }}> ({issue.variant_name})</span>
                        )}
                      </Link>
                    </td>
                    <td style={{ padding: "4px 8px", color: "#666" }}>
                      <Link href={`/issue/${issue.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                        {issue.publication_date || issue.key_date || "—"}
                      </Link>
                    </td>
                    <td style={{ padding: "4px 8px", color: "#666" }}>
                      <Link href={`/issue/${issue.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                        {issue.price || "—"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {undated.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 20, borderBottom: "2px solid #333", paddingBottom: 4, marginBottom: 12 }}>
            Undated
            <span style={{ fontWeight: 400, fontSize: 14, color: "#999", marginLeft: 8 }}>
              ({undated.length.toLocaleString()})
            </span>
          </h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                <th style={{ padding: "4px 8px 4px 0", width: 48 }}></th>
                <th style={{ padding: "4px 8px", width: 60 }}>#</th>
                <th style={{ padding: "4px 8px" }}>Date</th>
                <th style={{ padding: "4px 8px", width: 80 }}>Price</th>
              </tr>
            </thead>
            <tbody>
              {undated.map((issue) => (
                <tr key={issue.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "4px 8px 4px 0" }}>
                    <Link href={`/issue/${issue.id}`} style={{ display: "block", textDecoration: "none" }}>
                      {scannedIssues.has(String(issue.id)) ? (
                        <img
                          src={`/api/scans/image?issue=${issue.id}&side=front&t=${cacheBust}`}
                          alt=""
                          style={{ width: 32, height: 48, objectFit: "cover", borderRadius: 2, verticalAlign: "middle" }}
                        />
                      ) : (
                        <div style={{ width: 32, height: 48, background: "#1a1a1a", borderRadius: 2, border: "1px solid #333" }} />
                      )}
                    </Link>
                  </td>
                  <td style={{ padding: "4px 8px", fontWeight: 600 }}>
                    <Link href={`/issue/${issue.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                      {issue.number}
                      {issue.variant_name && (
                        <span style={{ fontWeight: 400, color: "#999", fontSize: 12 }}> ({issue.variant_name})</span>
                      )}
                    </Link>
                  </td>
                  <td style={{ padding: "4px 8px", color: "#666" }}>—</td>
                  <td style={{ padding: "4px 8px", color: "#666" }}>
                    <Link href={`/issue/${issue.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                      {issue.price || "—"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
