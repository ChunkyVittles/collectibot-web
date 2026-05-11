import pool from "@/app/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ id: string }>;
};

export const revalidate = 3600;

type PublisherRow = {
  id: number;
  name: string;
  country: string | null;
  year_began: number | null;
  year_ended: number | null;
};

type SeriesRow = {
  id: number;
  name: string;
  year_began: number | null;
  year_ended: number | null;
  issue_count: number | null;
  scan_count: number;
};

type CreatorRow = {
  id: number;
  name: string;
  credit_count: number;
};

function decadeLabel(year: number): string {
  return `${Math.floor(year / 10) * 10}s`;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const result = await pool.query<PublisherRow>(
    `SELECT id, name, country, year_began, year_ended FROM publishers WHERE id = $1`,
    [id]
  );
  if (result.rows.length === 0) return { title: "Publisher Not Found - Collectibot" };
  const p = result.rows[0];

  const years = p.year_began
    ? p.year_ended && p.year_ended !== p.year_began
      ? `${p.year_began}–${p.year_ended}`
      : p.year_ended
        ? `${p.year_began}`
        : `${p.year_began}–present`
    : "";

  const titleBits = [p.name];
  if (years) titleBits.push(`(${years})`);
  const title = `${titleBits.join(" ")} - Collectibot`;

  const descBits = [p.name];
  if (years) descBits.push(`comics publisher ${years}`);
  if (p.country) descBits.push(p.country);
  const description = `${descBits.join(", ")}. Browse series and creators.`;

  return { title, description };
}

export default async function PublisherPage({ params }: Props) {
  const { id } = await params;

  const publisherRes = await pool.query<PublisherRow>(
    `SELECT id, name, country, year_began, year_ended FROM publishers WHERE id = $1`,
    [id]
  );
  if (publisherRes.rows.length === 0) return notFound();
  const publisher = publisherRes.rows[0];

  // Series for this publisher, with cover-scan counts.
  // scans is small (~600 rows), so the LEFT JOIN is cheap.
  const seriesRes = await pool.query<SeriesRow>(
    `SELECT s.id, s.name, s.year_began, s.year_ended, s.issue_count,
            COALESCE(scan_counts.scan_count, 0)::int AS scan_count
     FROM series s
     LEFT JOIN (
       SELECT i.series_id, count(DISTINCT i.id) AS scan_count
       FROM scans sc
       JOIN issues i ON sc.issue_id = i.id
       WHERE sc.scan_type = 'front_cover'
       GROUP BY i.series_id
     ) scan_counts ON scan_counts.series_id = s.id
     WHERE s.publisher_id = $1
     ORDER BY s.year_began NULLS LAST, s.name`,
    [id]
  );

  // Top creators for this publisher: by credit count across all their series.
  const creatorsRes = await pool.query<CreatorRow>(
    `SELECT c.id, c.name, count(*)::int AS credit_count
     FROM issue_credits ic
     JOIN issues i ON ic.issue_id = i.id
     JOIN series s ON i.series_id = s.id
     JOIN creators c ON ic.creator_id = c.id
     WHERE s.publisher_id = $1
     GROUP BY c.id, c.name
     ORDER BY credit_count DESC, c.name
     LIMIT 30`,
    [id]
  );

  const seriesList = seriesRes.rows;
  const totalSeries = seriesList.length;
  const totalIssues = seriesList.reduce((acc, s) => acc + (s.issue_count ?? 0), 0);
  const totalScans = seriesList.reduce((acc, s) => acc + s.scan_count, 0);

  // Group series by decade of year_began
  const decades = new Map<string, SeriesRow[]>();
  const undated: SeriesRow[] = [];
  for (const s of seriesList) {
    if (!s.year_began) {
      undated.push(s);
    } else {
      const label = decadeLabel(s.year_began);
      if (!decades.has(label)) decades.set(label, []);
      decades.get(label)!.push(s);
    }
  }
  const sortedDecades = Array.from(decades.keys()).sort();

  const years = publisher.year_began
    ? publisher.year_ended && publisher.year_ended !== publisher.year_began
      ? `${publisher.year_began}–${publisher.year_ended}`
      : publisher.year_ended
        ? `${publisher.year_began}`
        : `${publisher.year_began}–present`
    : "";

  return (
    <div style={{ maxWidth: 900, margin: "40px auto", padding: "0 20px", fontFamily: "system-ui" }}>
      <Link href="/" style={{ color: "#666", textDecoration: "none" }}>
        &larr; Back to search
      </Link>

      <h1 style={{ marginTop: 16, marginBottom: 4 }}>{publisher.name}</h1>
      <p style={{ color: "#666", margin: "0 0 8px 0" }}>
        {[publisher.country, years].filter(Boolean).join(" · ")}
      </p>
      <p style={{ color: "#999", margin: "0 0 24px 0" }}>
        {totalSeries.toLocaleString()} series · {totalIssues.toLocaleString()} issues
        {totalScans > 0 && <> · {totalScans.toLocaleString()} cover scans</>}
      </p>

      {/* Top creators */}
      {creatorsRes.rows.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Top creators</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {creatorsRes.rows.map((c) => (
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
                  <span style={{ color: "#888", marginLeft: 6 }}>{c.credit_count.toLocaleString()}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Series by decade */}
      <h2 style={{ fontSize: 18, marginTop: 32, marginBottom: 12 }}>Series</h2>
      {sortedDecades.map((decade) => {
        const items = decades.get(decade)!;
        return <SeriesDecade key={decade} title={decade} items={items} />;
      })}

      {undated.length > 0 && <SeriesDecade title="Undated" items={undated} />}
    </div>
  );
}

function SeriesDecade({ title, items }: { title: string; items: SeriesRow[] }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h3 style={{ fontSize: 20, borderBottom: "2px solid #333", paddingBottom: 4, marginBottom: 12 }}>
        {title}
        <span style={{ fontWeight: 400, fontSize: 14, color: "#999", marginLeft: 8 }}>
          ({items.length.toLocaleString()})
        </span>
      </h3>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th style={{ padding: "4px 8px 4px 0" }}>Series</th>
            <th style={{ padding: "4px 8px", width: 120 }}>Years</th>
            <th style={{ padding: "4px 8px", width: 80 }}>Issues</th>
            <th style={{ padding: "4px 8px", width: 80 }}>Scans</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => {
            const yr = s.year_began
              ? s.year_ended && s.year_ended !== s.year_began
                ? `${s.year_began}–${s.year_ended}`
                : `${s.year_began}`
              : "—";
            return (
              <tr key={s.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "4px 8px 4px 0" }}>
                  <Link href={`/series/${s.id}`} style={{ color: "inherit", textDecoration: "none", borderBottom: "1px solid #444" }}>
                    {s.name}
                  </Link>
                </td>
                <td style={{ padding: "4px 8px", color: "#666" }}>{yr}</td>
                <td style={{ padding: "4px 8px", color: "#999" }}>{(s.issue_count ?? 0).toLocaleString()}</td>
                <td style={{ padding: "4px 8px", color: s.scan_count > 0 ? "#d4a017" : "#555" }}>
                  {s.scan_count > 0 ? s.scan_count.toLocaleString() : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
