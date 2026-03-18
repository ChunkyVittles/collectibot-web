import pool from "@/app/lib/db";
import Link from "next/link";

export const metadata = {
  title: "Vintage Postcards - Collectibot",
  description: "Browse vintage postcard scans by publisher, era, location, and subject.",
};

type Props = {
  searchParams: Promise<{ tag?: string }>;
};

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export default async function PostcardsPage({ searchParams }: Props) {
  const { tag } = await searchParams;

  // If filtering by tag, show filtered results
  if (tag) {
    const result = await pool.query<{
      id: number;
      description: string | null;
      era: string | null;
      postmark_city: string | null;
      postmark_state: string | null;
      postmark_year: number | null;
    }>(
      `SELECT p.id, p.description, p.era, p.postmark_city, p.postmark_state, p.postmark_year
       FROM postcards p
       WHERE $1 = ANY(p.subject_tags)
       ORDER BY p.postmark_year ASC NULLS LAST, p.id DESC`,
      [tag]
    );
    const postcards = result.rows;
    const cacheBust = Date.now();

    return (
      <div style={{ maxWidth: 900, margin: "40px auto", padding: "0 20px", fontFamily: "system-ui" }}>
        <Link href="/postcards" style={{ color: "#666", textDecoration: "none" }}>&larr; All Postcards</Link>
        <h1 style={{ marginTop: 16, marginBottom: 8, fontSize: 28 }}>Postcards tagged &ldquo;{tag}&rdquo;</h1>
        <p style={{ color: "#888", marginTop: 0, marginBottom: 32 }}>
          {postcards.length} postcard{postcards.length !== 1 ? "s" : ""}
        </p>
        <PostcardGrid postcards={postcards} cacheBust={cacheBust} />
      </div>
    );
  }

  // Main index: show categories + all postcards
  const allPostcards = await pool.query<{
    id: number;
    description: string | null;
    era: string | null;
    postmark_city: string | null;
    postmark_state: string | null;
    postmark_year: number | null;
    publisher: string | null;
  }>(
    `SELECT p.id, p.description, p.era, p.postmark_city, p.postmark_state, p.postmark_year, p.publisher
     FROM postcards p
     ORDER BY p.postmark_year ASC NULLS LAST, p.id DESC`
  );

  // Aggregate categories
  const publishers = new Map<string, number>();
  const eras = new Map<string, number>();
  const states = new Map<string, number>();

  for (const pc of allPostcards.rows) {
    if (pc.publisher) publishers.set(pc.publisher, (publishers.get(pc.publisher) || 0) + 1);
    if (pc.era) eras.set(pc.era, (eras.get(pc.era) || 0) + 1);
    if (pc.postmark_state) states.set(pc.postmark_state, (states.get(pc.postmark_state) || 0) + 1);
  }

  const cacheBust = Date.now();

  return (
    <div style={{ maxWidth: 900, margin: "40px auto", padding: "0 20px", fontFamily: "system-ui" }}>
      <Link href="/" style={{ color: "#666", textDecoration: "none" }}>&larr; Home</Link>

      <h1 style={{ marginTop: 16, marginBottom: 8, fontSize: 28 }}>Vintage Postcards</h1>
      <p style={{ color: "#888", marginTop: 0, marginBottom: 32 }}>{allPostcards.rows.length} postcards</p>

      {/* Category sections */}
      <div style={{ display: "flex", gap: 32, marginBottom: 40, flexWrap: "wrap" }}>
        {publishers.size > 0 && (
          <div>
            <h3 style={{ fontSize: 14, color: "#888", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Publishers</h3>
            {[...publishers.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => (
              <div key={name} style={{ marginBottom: 4 }}>
                <Link href={`/postcards/publisher/${encodeURIComponent(slugify(name))}`} style={{ color: "inherit", textDecoration: "none", fontSize: 14 }}>
                  {name} <span style={{ color: "#666" }}>({count})</span>
                </Link>
              </div>
            ))}
          </div>
        )}

        {eras.size > 0 && (
          <div>
            <h3 style={{ fontSize: 14, color: "#888", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Eras</h3>
            {[...eras.entries()].map(([name, count]) => (
              <div key={name} style={{ marginBottom: 4 }}>
                <Link href={`/postcards/era/${encodeURIComponent(slugify(name))}`} style={{ color: "inherit", textDecoration: "none", fontSize: 14 }}>
                  {name} <span style={{ color: "#666" }}>({count})</span>
                </Link>
              </div>
            ))}
          </div>
        )}

        {states.size > 0 && (
          <div>
            <h3 style={{ fontSize: 14, color: "#888", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Locations</h3>
            {[...states.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => (
              <div key={name} style={{ marginBottom: 4 }}>
                <Link href={`/postcards/location/${encodeURIComponent(slugify(name))}`} style={{ color: "inherit", textDecoration: "none", fontSize: 14 }}>
                  {name} <span style={{ color: "#666" }}>({count})</span>
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* All postcards */}
      <h2 style={{ fontSize: 18, marginBottom: 16 }}>All Postcards</h2>
      <PostcardGrid postcards={allPostcards.rows} cacheBust={cacheBust} />
    </div>
  );
}

function PostcardGrid({ postcards, cacheBust }: { postcards: Array<{ id: number; description: string | null; era: string | null; postmark_city: string | null; postmark_state: string | null; postmark_year: number | null }>; cacheBust: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 20 }}>
      {postcards.map((pc) => (
        <Link key={pc.id} href={`/postcards/${pc.id}`} style={{ textDecoration: "none", color: "inherit" }}>
          <div style={{ border: "1px solid #333", borderRadius: 6, overflow: "hidden", background: "#1a1a1a" }}>
            <img
              src={`/api/scans/image?postcard=${pc.id}&side=front&t=${cacheBust}`}
              alt={pc.description || "Postcard"}
              style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover" }}
            />
            <div style={{ padding: "10px 12px" }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {pc.description || "Untitled postcard"}
              </div>
              <div style={{ fontSize: 12, color: "#888" }}>
                {[pc.postmark_city, pc.postmark_state].filter(Boolean).join(", ")}
                {pc.postmark_year && ` (${pc.postmark_year})`}
              </div>
              {pc.era && <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{pc.era}</div>}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
