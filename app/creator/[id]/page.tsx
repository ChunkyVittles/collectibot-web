"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Creator = {
  id: number;
  name: string;
  bio: string | null;
  birth_year: number | null;
  birth_city: string | null;
  birth_country: string | null;
  death_year: number | null;
};

type Credit = {
  credit_type: string;
  issue_id: number;
  number: string;
  key_date: string | null;
  series_id: number;
  series_name: string;
  publisher: string | null;
  key_comment_1: string | null;
};

function decadeLabel(year: number): string {
  const d = Math.floor(year / 10) * 10;
  return `${d}s`;
}

function yearFromKeyDate(kd: string | null): number | null {
  if (!kd || kd.length < 4) return null;
  const y = parseInt(kd.substring(0, 4), 10);
  return isNaN(y) ? null : y;
}

function formatCreditType(ct: string): string {
  return ct.charAt(0).toUpperCase() + ct.slice(1);
}

export default function CreatorPage() {
  const params = useParams();
  const id = params.id as string;

  const [creator, setCreator] = useState<Creator | null>(null);
  const [credits, setCredits] = useState<Credit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [filterType, setFilterType] = useState("all");
  const [filterPublisher, setFilterPublisher] = useState("all");

  useEffect(() => {
    fetch(`/api/creator/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setCreator(data.creator);
        setCredits(data.credits);
        setTotal(data.total);
        setLoading(false);
      });
  }, [id]);

  if (loading) {
    return (
      <div style={{ maxWidth: 800, margin: "40px auto", padding: "0 20px", fontFamily: "system-ui" }}>
        <p>Loading...</p>
      </div>
    );
  }

  if (!creator) {
    return (
      <div style={{ maxWidth: 800, margin: "40px auto", padding: "0 20px", fontFamily: "system-ui" }}>
        <p>Creator not found.</p>
      </div>
    );
  }

  // Collect unique credit types and publishers for filter options
  const creditTypes = Array.from(new Set(credits.map((c) => c.credit_type))).sort();
  const publishers = Array.from(new Set(credits.map((c) => c.publisher).filter(Boolean) as string[])).sort();

  // Apply filters
  const filtered = credits.filter((c) => {
    if (filterType !== "all" && c.credit_type !== filterType) return false;
    if (filterPublisher !== "all" && c.publisher !== filterPublisher) return false;
    return true;
  });

  // Merge credits for the same issue into one row with combined roles
  type MergedCredit = Credit & { roles: string };
  const mergedMap = new Map<number, MergedCredit>();
  for (const c of filtered) {
    const existing = mergedMap.get(c.issue_id);
    if (existing) {
      const roles = new Set(existing.roles.split(", "));
      roles.add(formatCreditType(c.credit_type));
      existing.roles = Array.from(roles).join(", ");
      if (!existing.key_comment_1 && c.key_comment_1) existing.key_comment_1 = c.key_comment_1;
    } else {
      mergedMap.set(c.issue_id, { ...c, roles: formatCreditType(c.credit_type) });
    }
  }
  const merged = Array.from(mergedMap.values());

  // Group by decade
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

  // Sort decade keys
  const sortedDecades = Array.from(decades.keys()).sort();

  // Life dates string
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
        {total.toLocaleString()} credited works
      </p>
      {creator.bio && (
        <p style={{ color: "#444", lineHeight: 1.5, margin: "0 0 24px 0", maxWidth: 600 }}>
          {creator.bio}
        </p>
      )}

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          style={{ padding: "6px 10px", fontSize: 14, border: "1px solid #ccc", borderRadius: 4 }}
        >
          <option value="all">All types ({total.toLocaleString()})</option>
          {creditTypes.map((ct) => (
            <option key={ct} value={ct}>
              {formatCreditType(ct)} ({credits.filter((c) => c.credit_type === ct).length.toLocaleString()})
            </option>
          ))}
        </select>
        <select
          value={filterPublisher}
          onChange={(e) => setFilterPublisher(e.target.value)}
          style={{ padding: "6px 10px", fontSize: 14, border: "1px solid #ccc", borderRadius: 4 }}
        >
          <option value="all">All publishers</option>
          {publishers.map((pub) => (
            <option key={pub} value={pub}>
              {pub}
            </option>
          ))}
        </select>
        {(filterType !== "all" || filterPublisher !== "all") && (
          <span style={{ fontSize: 14, color: "#666", alignSelf: "center" }}>
            {filtered.length.toLocaleString()} results
          </span>
        )}
      </div>

      {/* Timeline by decade */}
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
                  <th style={{ padding: "4px 8px 4px 0", width: 40 }}></th>
                  <th style={{ padding: "4px 8px 4px 0", width: 50 }}>Year</th>
                  <th style={{ padding: "4px 8px" }}>Series</th>
                  <th style={{ padding: "4px 8px", width: 50 }}>#</th>
                  <th style={{ padding: "4px 8px", width: 80 }}>Role</th>
                  <th style={{ padding: "4px 8px", width: 120 }}>Publisher</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c, i) => {
                  const year = yearFromKeyDate(c.key_date);
                  return (
                    <tr key={c.issue_id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "4px 8px 4px 0" }}>
                        <Link href={`/issue/${c.issue_id}`} style={{ display: "block", textDecoration: "none" }}>
                          <img
                            src={`/api/scans/image?issue=${c.issue_id}&side=front`}
                            alt=""
                            style={{ width: 32, height: 48, objectFit: "cover", borderRadius: 2, verticalAlign: "middle", background: "#eee", border: "1px solid #ddd" }}
                            onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.15"; }}
                          />
                        </Link>
                      </td>
                      <td style={{ padding: "4px 8px 4px 0", color: "#666" }}>{year}</td>
                      <td style={{ padding: "4px 8px" }}>
                        <Link href={`/series/${c.series_id}`} style={{ color: "inherit", textDecoration: "none", borderBottom: "1px solid #ccc" }}>
                          {c.series_name}
                        </Link>
                        {c.key_comment_1 && (
                          <span style={{
                            marginLeft: 8,
                            fontSize: 11,
                            color: "#c62828",
                            fontWeight: 600,
                          }}>
                            ★ {c.key_comment_1}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "4px 8px" }}>{c.number}</td>
                      <td style={{ padding: "4px 8px", color: "#666" }}>{c.roles}</td>
                      <td style={{ padding: "4px 8px", color: "#999" }}>{c.publisher || "—"}</td>
                    </tr>
                  );
                })}
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
                <th style={{ padding: "4px 8px 4px 0", width: 50 }}>Year</th>
                <th style={{ padding: "4px 8px" }}>Series</th>
                <th style={{ padding: "4px 8px", width: 50 }}>#</th>
                <th style={{ padding: "4px 8px", width: 80 }}>Role</th>
                <th style={{ padding: "4px 8px", width: 120 }}>Publisher</th>
              </tr>
            </thead>
            <tbody>
              {undated.map((c, i) => (
                <tr key={`undated-${c.issue_id}`} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "4px 8px 4px 0" }}>
                    <Link href={`/issue/${c.issue_id}`} style={{ display: "block", textDecoration: "none" }}>
                      <img
                        src={`/api/scans/image?issue=${c.issue_id}&side=front`}
                        alt=""
                        style={{ width: 32, height: 48, objectFit: "cover", borderRadius: 2, verticalAlign: "middle", background: "#1a1a1a", border: "1px solid #333" }}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    </Link>
                  </td>
                  <td style={{ padding: "4px 8px 4px 0", color: "#666" }}>—</td>
                  <td style={{ padding: "4px 8px" }}>
                    <Link href={`/series/${c.series_id}`} style={{ color: "inherit", textDecoration: "none", borderBottom: "1px solid #ccc" }}>
                      {c.series_name}
                    </Link>
                    {c.key_comment_1 && (
                      <span style={{
                        marginLeft: 8,
                        fontSize: 11,
                        color: "#c62828",
                        fontWeight: 600,
                      }}>
                        ★ {c.key_comment_1}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "4px 8px" }}>{c.number}</td>
                  <td style={{ padding: "4px 8px", color: "#666" }}>{formatCreditType(c.credit_type)}</td>
                  <td style={{ padding: "4px 8px", color: "#999" }}>{c.publisher || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
