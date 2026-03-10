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

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #333", textAlign: "left" }}>
            <th style={{ padding: "8px 8px 8px 0", width: 60 }}>#</th>
            <th style={{ padding: 8 }}>Date</th>
            <th style={{ padding: 8 }}>Price</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue) => (
            <tr key={issue.id} style={{ borderBottom: "1px solid #eee" }}>
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
