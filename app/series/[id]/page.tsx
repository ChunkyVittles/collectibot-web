import pool from "@/app/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ id: string }>;
};

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

  // Get all scans for issues in this series
  const scannedRes = await pool.query(
    `SELECT sc.issue_id, sc.scan_type
     FROM scans sc
     JOIN issues i ON sc.issue_id = i.id
     WHERE i.series_id = $1`,
    [id]
  );

  const scannedIssues = new Set<string>();
  for (const row of scannedRes.rows) {
    if (row.scan_type === "front_cover") {
      scannedIssues.add(String(row.issue_id));
    }
  }

  const issues = issuesRes.rows;
  const years = series.year_ended
    ? `${series.year_began}–${series.year_ended}`
    : `${series.year_began}–present`;

  return (
    <div style={{ maxWidth: 700, margin: "40px auto", padding: "0 20px", fontFamily: "system-ui" }}>
      <Link href="/" style={{ color: "#666", textDecoration: "none" }}>
        &larr; Back to search
      </Link>

      <h1 style={{ marginTop: 16, marginBottom: 4 }}>{series.name}</h1>
      <p style={{ color: "#666", margin: 0 }}>
        {series.publisher_name && <>{series.publisher_name} &middot; </>}
        {years}
        {series.format && <> &middot; {series.format}</>}
      </p>

      <h2 style={{ marginTop: 32, marginBottom: 12 }}>
        Issues ({issues.length})
      </h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 16, marginBottom: 32 }}>
        {issues.filter((issue) => scannedIssues.has(String(issue.id))).map((issue) => (
          <Link
            key={issue.id}
            href={`/issue/${issue.id}`}
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <div style={{ textAlign: "center" }}>
              <img
                src={`/api/scans/image?issue=${issue.id}&side=front`}
                alt={`${series.name} #${issue.number}`}
                style={{
                  width: "100%",
                  borderRadius: 4,
                  border: "1px solid #333",
                  aspectRatio: "2/3",
                  objectFit: "cover",
                  background: "#111",
                }}
              />
              <div style={{ fontSize: 13, marginTop: 4, fontWeight: 600 }}>
                #{issue.number}
              </div>
            </div>
          </Link>
        ))}
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #333", textAlign: "left" }}>
            <th style={{ padding: "8px 8px 8px 0", width: 40 }}></th>
            <th style={{ padding: "8px 8px 8px 0", width: 60 }}>#</th>
            <th style={{ padding: 8 }}>Date</th>
            <th style={{ padding: 8 }}>Price</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue) => (
            <tr key={issue.id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "4px 8px 4px 0" }}>
                {scannedIssues.has(String(issue.id)) ? (
                  <img
                    src={`/api/scans/image?issue=${issue.id}&side=front`}
                    alt=""
                    style={{ width: 32, height: 48, objectFit: "cover", borderRadius: 2, verticalAlign: "middle" }}
                  />
                ) : (
                  <div style={{ width: 32, height: 48, background: "#1a1a1a", borderRadius: 2, border: "1px solid #333" }} />
                )}
              </td>
              <td style={{ padding: "6px 8px 6px 0", fontWeight: 600 }}>
                {issue.number}
                {issue.variant_name && (
                  <span style={{ fontWeight: 400, color: "#999", fontSize: 12 }}>
                    {" "}({issue.variant_name})
                  </span>
                )}
              </td>
              <td style={{ padding: 6, color: "#666", whiteSpace: "nowrap" }}>
                {issue.publication_date || issue.key_date || "—"}
              </td>
              <td style={{ padding: 6, color: "#666" }}>
                {issue.price || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
