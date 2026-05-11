// TODO: replace structured About with AI-generated bio once the bio pipeline
// ships. See docs/followups/ai-bios.md.

import pool from "@/app/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import CreatorFilters from "./CreatorFilters";
import CreatorAbout from "./CreatorAbout";

type Props = {
  params: Promise<{ id: string }>;
};

export const revalidate = 3600;

type CreatorRow = {
  id: number;
  name: string;
  sort_name: string | null;
  birth_year: number | null;
  birth_city: string | null;
  birth_country: string | null;
  death_year: number | null;
};

type CreditRow = {
  credit_type: string;
  issue_id: number;
  number: string;
  key_date: string | null;
  series_id: number;
  series_name: string;
  publisher_id: number | null;
  publisher: string | null;
  key_comment_1: string | null;
};

type CollaboratorRow = {
  id: number;
  name: string;
  shared_count: number;
};

type PublisherCountRow = {
  id: number;
  name: string;
  issue_count: number;
};

type MergedCredit = {
  issue_id: number;
  number: string;
  key_date: string | null;
  series_id: number;
  series_name: string;
  publisher_id: number | null;
  publisher: string | null;
  key_comment_1: string | null;
  credit_types: Set<string>;
};

const CREDIT_TYPE_LABELS: Record<string, string> = {
  script: "Writer",
  pencils: "Pencils",
  inks: "Inks",
  colors: "Colors",
  letters: "Letters",
  editing: "Editing",
};

function labelFor(creditType: string): string {
  return CREDIT_TYPE_LABELS[creditType] ?? creditType.charAt(0).toUpperCase() + creditType.slice(1);
}

function decadeLabel(year: number): string {
  return `${Math.floor(year / 10) * 10}s`;
}

function yearFromKeyDate(kd: string | null): number | null {
  if (!kd || kd.length < 4) return null;
  const y = parseInt(kd.substring(0, 4), 10);
  return isNaN(y) ? null : y;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const result = await pool.query<{
    name: string;
    birth_year: number | null;
    death_year: number | null;
    birth_country: string | null;
  }>(
    `SELECT name, birth_year, death_year, birth_country
     FROM creators WHERE id = $1`,
    [id]
  );
  if (result.rows.length === 0) return { title: "Creator Not Found - Collectibot" };
  const c = result.rows[0];

  const years = c.birth_year
    ? ` (${c.birth_year}${c.death_year ? `–${c.death_year}` : ""})`
    : "";
  const title = `${c.name}${years} - Collectibot`;

  const descBits = [`${c.name}${years}`];
  if (c.birth_country) descBits.push(`from ${c.birth_country}`);
  descBits.push("comic book credits and creative contributions");
  const description = descBits.join(", ") + ".";

  return { title, description };
}

export default async function CreatorPage({ params }: Props) {
  const { id } = await params;

  const creatorRes = await pool.query<CreatorRow>(
    `SELECT id, name, sort_name, birth_year, birth_city, birth_country, death_year
     FROM creators WHERE id = $1`,
    [id]
  );
  if (creatorRes.rows.length === 0) return notFound();
  const creator = creatorRes.rows[0];

  // All credits for this creator, with publisher info and any key-issue note.
  const creditsRes = await pool.query<CreditRow>(
    `SELECT ic.credit_type,
            i.id AS issue_id, i.number, i.key_date,
            s.id AS series_id, s.name AS series_name,
            p.id AS publisher_id, p.name AS publisher,
            ki.key_comment_1
     FROM issue_credits ic
     JOIN issues i ON ic.issue_id = i.id
     JOIN series s ON i.series_id = s.id
     LEFT JOIN publishers p ON s.publisher_id = p.id
     LEFT JOIN LATERAL (
       SELECT key_comment_1 FROM key_issues
       WHERE issue_id = i.id AND key_comment_1 IS NOT NULL LIMIT 1
     ) ki ON true
     WHERE ic.creator_id = $1
     ORDER BY i.key_date ASC NULLS LAST, s.name, i.number`,
    [id]
  );

  // Frequent collaborators: top 10 creators co-credited on the same issues.
  const collaboratorsRes = await pool.query<CollaboratorRow>(
    `SELECT c.id, c.name, count(DISTINCT ic2.issue_id)::int AS shared_count
     FROM issue_credits ic1
     JOIN issue_credits ic2 ON ic1.issue_id = ic2.issue_id AND ic1.creator_id <> ic2.creator_id
     JOIN creators c ON ic2.creator_id = c.id
     WHERE ic1.creator_id = $1
     GROUP BY c.id, c.name
     ORDER BY shared_count DESC, c.name
     LIMIT 10`,
    [id]
  );

  // Publishers worked for: distinct issue count per publisher.
  const publishersRes = await pool.query<PublisherCountRow>(
    `SELECT p.id, p.name, count(DISTINCT i.id)::int AS issue_count
     FROM issue_credits ic
     JOIN issues i ON ic.issue_id = i.id
     JOIN series s ON i.series_id = s.id
     JOIN publishers p ON s.publisher_id = p.id
     WHERE ic.creator_id = $1
     GROUP BY p.id, p.name
     ORDER BY issue_count DESC, p.name`,
    [id]
  );

  // Top series by distinct issue credit count.
  const topSeriesRes = await pool.query<{ id: number; name: string; credit_count: number }>(
    `SELECT s.id, s.name, count(DISTINCT i.id)::int AS credit_count
     FROM issue_credits ic
     JOIN issues i ON ic.issue_id = i.id
     JOIN series s ON i.series_id = s.id
     WHERE ic.creator_id = $1
     GROUP BY s.id, s.name
     ORDER BY credit_count DESC, s.name
     LIMIT 5`,
    [id]
  );

  // Merge credit rows per issue so a single issue with multiple roles
  // becomes one row whose data-credit-type lists all its roles.
  const mergedMap = new Map<number, MergedCredit>();
  const creditTypeCounts = new Map<string, number>();
  for (const c of creditsRes.rows) {
    creditTypeCounts.set(c.credit_type, (creditTypeCounts.get(c.credit_type) ?? 0) + 1);
    const existing = mergedMap.get(c.issue_id);
    if (existing) {
      existing.credit_types.add(c.credit_type);
      if (!existing.key_comment_1 && c.key_comment_1) existing.key_comment_1 = c.key_comment_1;
    } else {
      mergedMap.set(c.issue_id, {
        issue_id: c.issue_id,
        number: c.number,
        key_date: c.key_date,
        series_id: c.series_id,
        series_name: c.series_name,
        publisher_id: c.publisher_id,
        publisher: c.publisher,
        key_comment_1: c.key_comment_1,
        credit_types: new Set([c.credit_type]),
      });
    }
  }
  const merged = Array.from(mergedMap.values());

  // Decade-group the merged credits.
  const decades = new Map<string, MergedCredit[]>();
  const undated: MergedCredit[] = [];
  for (const c of merged) {
    const year = yearFromKeyDate(c.key_date);
    if (!year) {
      undated.push(c);
    } else {
      const label = decadeLabel(year);
      if (!decades.has(label)) decades.set(label, []);
      decades.get(label)!.push(c);
    }
  }
  const sortedDecades = Array.from(decades.keys()).sort();

  // Filter dropdown options
  const creditTypeOptions = Array.from(creditTypeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, label: labelFor(key), count }));
  const publisherOptions = publishersRes.rows.map((p) => ({ name: p.name, count: p.issue_count }));

  // Life-dates and origin string
  const lifeParts: string[] = [];
  if (creator.birth_year) {
    lifeParts.push(
      creator.death_year
        ? `${creator.birth_year}–${creator.death_year}`
        : `b. ${creator.birth_year}`
    );
  }
  if (creator.birth_city || creator.birth_country) {
    lifeParts.push([creator.birth_city, creator.birth_country].filter(Boolean).join(", "));
  }

  const totalCredits = merged.length;
  const collaborators = collaboratorsRes.rows;
  const publishers = publishersRes.rows;

  // Active span and peak decade derived from our credits.
  let firstYear: number | null = null;
  let lastYear: number | null = null;
  let peakDecade: string | null = null;
  let peakCount = 0;
  for (const [label, items] of decades.entries()) {
    if (items.length > peakCount) {
      peakCount = items.length;
      peakDecade = label;
    }
  }
  for (const c of merged) {
    const y = yearFromKeyDate(c.key_date);
    if (y == null) continue;
    if (firstYear == null || y < firstYear) firstYear = y;
    if (lastYear == null || y > lastYear) lastYear = y;
  }

  return (
    <div style={{ maxWidth: 800, margin: "40px auto", padding: "0 20px", fontFamily: "system-ui" }}>
      <Link href="/" style={{ color: "#666", textDecoration: "none" }}>
        &larr; Back to search
      </Link>

      {/* Header */}
      <h1 style={{ marginTop: 16, marginBottom: 4 }}>{creator.name}</h1>
      {lifeParts.length > 0 && (
        <p style={{ color: "#666", margin: "0 0 8px 0" }}>{lifeParts.join(" · ")}</p>
      )}
      <p style={{ color: "#999", margin: "0 0 16px 0" }}>
        {totalCredits.toLocaleString()} credited issues · {creditsRes.rows.length.toLocaleString()} role credits
      </p>
      {/* Structured "About" derived from our own data — replaces the GCD
          bio paragraph and the old standalone publishers / collaborators
          tag clouds. Returns null when there's not enough data. */}
      <CreatorAbout
        totalIssues={totalCredits}
        firstYear={firstYear}
        lastYear={lastYear}
        peakDecade={peakDecade}
        publisherCount={publishers.length}
        topPublishers={publishers.slice(0, 3).map((p) => ({ id: p.id, name: p.name }))}
        topCollaborators={collaborators.slice(0, 3).map((c) => ({ id: c.id, name: c.name }))}
        topSeries={topSeriesRes.rows.slice(0, 3).map((s) => ({ id: s.id, name: s.name }))}
      />

      {/* Filter island (client) */}
      <CreatorFilters
        creditTypes={creditTypeOptions}
        publishers={publisherOptions}
        totalCredits={totalCredits}
      />

      {/* Credit table — fully SSR'd. CreatorFilters injects CSS that hides
          rows whose data-credit-type / data-publisher don't match. */}
      {sortedDecades.map((decade) => {
        const items = decades.get(decade)!;
        return <DecadeSection key={decade} title={decade} items={items} />;
      })}

      {undated.length > 0 && <DecadeSection title="Undated" items={undated} />}
    </div>
  );
}

function DecadeSection({ title, items }: { title: string; items: MergedCredit[] }) {
  return (
    <section className="credit-decade" style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 20, borderBottom: "2px solid #333", paddingBottom: 4, marginBottom: 12 }}>
        {title}
        <span style={{ fontWeight: 400, fontSize: 14, color: "#999", marginLeft: 8 }}>
          ({items.length.toLocaleString()})
        </span>
      </h2>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th style={{ padding: "4px 8px 4px 0", width: 40 }}></th>
            <th style={{ padding: "4px 8px 4px 0", width: 50 }}>Year</th>
            <th style={{ padding: "4px 8px" }}>Series</th>
            <th style={{ padding: "4px 8px", width: 50 }}>#</th>
            <th style={{ padding: "4px 8px", width: 140 }}>Role</th>
            <th style={{ padding: "4px 8px", width: 120 }}>Publisher</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => {
            const year = yearFromKeyDate(c.key_date);
            const roleTypes = Array.from(c.credit_types);
            const roleLabel = roleTypes.map(labelFor).join(", ");
            return (
              <tr
                key={c.issue_id}
                className="credit-row"
                data-credit-type={roleTypes.join(" ")}
                data-publisher={c.publisher ?? ""}
                style={{ borderBottom: "1px solid #f0f0f0" }}
              >
                <td style={{ padding: "4px 8px 4px 0" }}>
                  <Link href={`/issue/${c.issue_id}`} style={{ display: "block", textDecoration: "none" }}>
                    <img
                      src={`/api/scans/image?issue=${c.issue_id}&side=front`}
                      alt=""
                      style={{ width: 32, height: 48, objectFit: "cover", borderRadius: 2, verticalAlign: "middle", background: "#1a1a1a", border: "1px solid #333" }}
                    />
                  </Link>
                </td>
                <td style={{ padding: "4px 8px 4px 0", color: "#666" }}>{year ?? "—"}</td>
                <td style={{ padding: "4px 8px" }}>
                  <Link href={`/series/${c.series_id}`} style={{ color: "inherit", textDecoration: "none", borderBottom: "1px solid #444" }}>
                    {c.series_name}
                  </Link>
                  {c.key_comment_1 && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: "#d4a017", fontWeight: 600 }}>
                      ★ {c.key_comment_1}
                    </span>
                  )}
                </td>
                <td style={{ padding: "4px 8px" }}>
                  <Link href={`/issue/${c.issue_id}`} style={{ color: "inherit", textDecoration: "none" }}>
                    {c.number}
                  </Link>
                </td>
                <td style={{ padding: "4px 8px", color: "#666" }}>{roleLabel}</td>
                <td style={{ padding: "4px 8px", color: "#999" }}>
                  {c.publisher_id && c.publisher ? (
                    <Link href={`/publisher/${c.publisher_id}`} style={{ color: "inherit", textDecoration: "none" }}>
                      {c.publisher}
                    </Link>
                  ) : (
                    c.publisher ?? "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
