"use client";

import { useState } from "react";
import Link from "next/link";

type Result = {
  type: "Series" | "Creator" | "Character";
  id: number;
  name: string;
  year_began?: number;
  year_ended?: number;
  publisher?: string;
  slug?: string;
  birth_year?: number;
  universe?: string;
  year_first_published?: number;
};

export default function Home() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < 2) return;

    setLoading(true);
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    setResults(data.results);
    setLoading(false);
  }

  function detail(r: Result): string {
    switch (r.type) {
      case "Series": {
        const parts: string[] = [];
        if (r.publisher) parts.push(r.publisher);
        const years = r.year_ended
          ? `${r.year_began}–${r.year_ended}`
          : `${r.year_began}–`;
        parts.push(years);
        return parts.join(" · ");
      }
      case "Creator":
        return r.birth_year ? `b. ${r.birth_year}` : "";
      case "Character": {
        const parts: string[] = [];
        if (r.universe) parts.push(r.universe);
        if (r.year_first_published) parts.push(`since ${r.year_first_published}`);
        return parts.join(" · ");
      }
    }
  }

  return (
    <div style={{ maxWidth: 700, margin: "80px auto", padding: "0 20px", fontFamily: "system-ui" }}>
      <h1>Collectibot</h1>
      <p style={{ color: "#666" }}>Search 20M+ comic book records</p>

      <form onSubmit={handleSearch} style={{ marginTop: 20 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search series, creators, characters..."
          style={{
            width: "100%",
            padding: "12px 16px",
            fontSize: 18,
            border: "2px solid #ccc",
            borderRadius: 6,
            boxSizing: "border-box",
          }}
        />
      </form>

      {loading && <p style={{ marginTop: 20 }}>Searching...</p>}

      {!loading && results.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, marginTop: 20 }}>
          {results.map((r) => (
            <li
              key={`${r.type}-${r.id}`}
              style={{
                padding: "12px 0",
                borderBottom: "1px solid #eee",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  padding: "2px 8px",
                  borderRadius: 3,
                  marginRight: 10,
                  background:
                    r.type === "Series"
                      ? "#e3f2fd"
                      : r.type === "Creator"
                      ? "#f3e5f5"
                      : "#e8f5e9",
                  color:
                    r.type === "Series"
                      ? "#1565c0"
                      : r.type === "Creator"
                      ? "#7b1fa2"
                      : "#2e7d32",
                }}
              >
                {r.type}
              </span>
              {r.type === "Series" ? (
                <Link href={`/series/${r.id}`} style={{ color: "inherit", textDecoration: "none" }}>
                  <strong style={{ borderBottom: "1px solid #ccc" }}>{r.name}</strong>
                </Link>
              ) : r.type === "Creator" ? (
                <Link href={`/creator/${r.id}`} style={{ color: "inherit", textDecoration: "none" }}>
                  <strong style={{ borderBottom: "1px solid #ccc" }}>{r.name}</strong>
                </Link>
              ) : (
                <strong>{r.name}</strong>
              )}
              {detail(r) && (
                <span style={{ color: "#999", marginLeft: 8 }}>
                  {detail(r)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {!loading && results.length === 0 && query.length >= 2 && (
        <p style={{ marginTop: 20, color: "#999" }}>No results</p>
      )}
    </div>
  );
}
