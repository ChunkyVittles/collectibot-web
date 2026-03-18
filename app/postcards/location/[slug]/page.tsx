import pool from "@/app/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ slug: string }>;
};

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function decadeLabel(year: number): string {
  const d = Math.floor(year / 10) * 10;
  return `${d}s`;
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const result = await pool.query<{ postmark_state: string }>(
    `SELECT DISTINCT postmark_state FROM postcards WHERE postmark_state IS NOT NULL`
  );
  const match = result.rows.find(r => slugify(r.postmark_state) === slug);
  if (!match) return { title: "Location Not Found" };
  return {
    title: `${match.postmark_state} Postcards - Collectibot`,
    description: `Browse vintage postcards from ${match.postmark_state}. Scanned front and back with postmark, publisher, and era details.`,
  };
}

export default async function LocationPage({ params }: Props) {
  const { slug } = await params;

  const stateResult = await pool.query<{ postmark_state: string }>(
    `SELECT DISTINCT postmark_state FROM postcards WHERE postmark_state IS NOT NULL`
  );
  const match = stateResult.rows.find(r => slugify(r.postmark_state) === slug);
  if (!match) return notFound();
  const stateName = match.postmark_state;

  const result = await pool.query<{
    id: number;
    description: string | null;
    era: string | null;
    publisher: string | null;
    postmark_city: string | null;
    postmark_state: string | null;
    postmark_year: number | null;
  }>(
    `SELECT id, description, era, publisher, postmark_city, postmark_state, postmark_year
     FROM postcards WHERE postmark_state = $1
     ORDER BY postmark_year ASC NULLS LAST, id DESC`,
    [stateName]
  );

  const postcards = result.rows;
  const cacheBust = Date.now();

  const cities = [...new Set(postcards.map(p => p.postmark_city).filter(Boolean))];
  const years: number[] = postcards.filter(p => p.postmark_year).map(p => p.postmark_year!);
  const yearRange = years.length > 0 ? `${Math.min(...years)}–${Math.max(...years)}` : null;

  // Group by decade
  const decades = new Map<string, typeof postcards>();
  const undated: typeof postcards = [];
  for (const pc of postcards) {
    if (pc.postmark_year) {
      const label = decadeLabel(pc.postmark_year);
      if (!decades.has(label)) decades.set(label, []);
      decades.get(label)!.push(pc);
    } else {
      undated.push(pc);
    }
  }
  const sortedDecades = Array.from(decades.keys()).sort();

  return (
    <div style={{ maxWidth: 800, margin: "40px auto", padding: "0 20px", fontFamily: "system-ui" }}>
      <Link href="/postcards" style={{ color: "#666", textDecoration: "none" }}>&larr; All Postcards</Link>

      <h1 style={{ marginTop: 16, marginBottom: 4 }}>{stateName}</h1>
      <p style={{ color: "#666", margin: "0 0 8px 0" }}>
        {[yearRange, cities.length > 0 ? `${cities.length} ${cities.length === 1 ? "city" : "cities"}` : null].filter(Boolean).join(" · ")}
      </p>
      <p style={{ color: "#999", margin: "0 0 16px 0" }}>
        {postcards.length} postcard{postcards.length !== 1 ? "s" : ""}
      </p>
      {cities.length > 1 && (
        <p style={{ color: "#444", lineHeight: 1.5, margin: "0 0 24px 0", maxWidth: 600 }}>
          Postcards from {cities.join(", ")}.
        </p>
      )}

      {/* Hero image */}
      {postcards.length > 0 && (
        <Link href={`/postcards/${postcards[0].id}`} style={{ textDecoration: "none" }}>
          <div style={{ marginBottom: 32, maxWidth: 300 }}>
            <img
              src={`/api/scans/image?postcard=${postcards[0].id}&side=front&t=${cacheBust}`}
              alt={postcards[0].description || "Postcard"}
              style={{ width: "100%", borderRadius: 6, border: "1px solid #333" }}
            />
          </div>
        </Link>
      )}

      {/* Decade-grouped timeline */}
      {sortedDecades.map((decade) => {
        const items = decades.get(decade)!;
        return (
          <div key={decade} style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 20, borderBottom: "2px solid #333", paddingBottom: 4, marginBottom: 12 }}>
              {decade}
              <span style={{ fontWeight: 400, fontSize: 14, color: "#999", marginLeft: 8 }}>({items.length})</span>
            </h2>
            <PostcardTable postcards={items} cacheBust={cacheBust} />
          </div>
        );
      })}

      {undated.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 20, borderBottom: "2px solid #333", paddingBottom: 4, marginBottom: 12 }}>
            Undated
            <span style={{ fontWeight: 400, fontSize: 14, color: "#999", marginLeft: 8 }}>({undated.length})</span>
          </h2>
          <PostcardTable postcards={undated} cacheBust={cacheBust} />
        </div>
      )}
    </div>
  );
}

function PostcardTable({ postcards, cacheBust }: { postcards: Array<{ id: number; description: string | null; era: string | null; publisher: string | null; postmark_city: string | null; postmark_state: string | null; postmark_year: number | null }>; cacheBust: number }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
      <thead>
        <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
          <th style={{ padding: "4px 8px 4px 0", width: 56 }}></th>
          <th style={{ padding: "4px 8px" }}>Description</th>
          <th style={{ padding: "4px 8px", width: 100 }}>City</th>
          <th style={{ padding: "4px 8px", width: 50 }}>Year</th>
          <th style={{ padding: "4px 8px", width: 100 }}>Era</th>
        </tr>
      </thead>
      <tbody>
        {postcards.map((pc) => (
          <tr key={pc.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
            <td style={{ padding: "4px 8px 4px 0" }}>
              <Link href={`/postcards/${pc.id}`} style={{ display: "block", textDecoration: "none" }}>
                <img src={`/api/scans/image?postcard=${pc.id}&side=front&t=${cacheBust}`} alt="" style={{ width: 48, height: 36, objectFit: "cover", borderRadius: 2, verticalAlign: "middle" }} />
              </Link>
            </td>
            <td style={{ padding: "4px 8px" }}>
              <Link href={`/postcards/${pc.id}`} style={{ textDecoration: "none", color: "inherit", borderBottom: "1px solid #ccc" }}>
                {pc.description || "Untitled"}
              </Link>
            </td>
            <td style={{ padding: "4px 8px", color: "#666" }}>{pc.postmark_city || "—"}</td>
            <td style={{ padding: "4px 8px", color: "#666" }}>{pc.postmark_year || "—"}</td>
            <td style={{ padding: "4px 8px", color: "#666" }}>{pc.era || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
