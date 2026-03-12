"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ReassignScansButton({ issueId }: { issueId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [seriesQuery, setSeriesQuery] = useState("");
  const [seriesResults, setSeriesResults] = useState<any[]>([]);
  const [selectedSeries, setSelectedSeries] = useState<any>(null);
  const [issues, setIssues] = useState<any[]>([]);
  const [selectedIssue, setSelectedIssue] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const searchSeries = async () => {
    if (!seriesQuery.trim()) return;
    const res = await fetch(`/api/admin/scans/search-series?q=${encodeURIComponent(seriesQuery)}`);
    const data = await res.json();
    setSeriesResults(data.series || data.results || []);
    setSelectedSeries(null);
    setIssues([]);
    setSelectedIssue(null);
  };

  const pickSeries = async (series: any) => {
    setSelectedSeries(series);
    setSeriesResults([]);
    const res = await fetch(`/api/admin/scans/issues?seriesId=${series.id}`);
    const data = await res.json();
    setIssues(data.issues || data || []);
  };

  const reassign = async () => {
    if (!selectedIssue) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/scans/reassign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromIssueId: issueId, toIssueId: selectedIssue }),
      });
      const data = await res.json();
      if (data.ok) {
        router.push(`/issue/${selectedIssue}`);
      } else {
        setError(data.error || "Failed to reassign");
      }
    } catch {
      setError("Network error");
    }
    setLoading(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          padding: "8px 16px",
          background: "none",
          border: "1px solid #666",
          color: "#aaa",
          borderRadius: 4,
          cursor: "pointer",
          marginLeft: 8,
        }}
      >
        Reassign Scans
      </button>
    );
  }

  return (
    <div
      style={{
        marginTop: 16,
        padding: 16,
        border: "1px solid #333",
        borderRadius: 6,
        background: "#111",
      }}
    >
      <div style={{ fontSize: 14, color: "#aaa", marginBottom: 12 }}>
        Move scans to a different issue:
      </div>

      {!selectedSeries ? (
        <>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={seriesQuery}
              onChange={(e) => setSeriesQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchSeries()}
              placeholder="Search series name..."
              style={{
                flex: 1,
                padding: 8,
                background: "#222",
                border: "1px solid #444",
                borderRadius: 4,
                color: "#fff",
              }}
            />
            <button
              onClick={searchSeries}
              style={{
                padding: "8px 16px",
                background: "#333",
                border: "none",
                borderRadius: 4,
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Search
            </button>
          </div>
          {seriesResults.length > 0 && (
            <div style={{ marginTop: 8, maxHeight: 200, overflow: "auto" }}>
              {seriesResults.map((s: any) => (
                <div
                  key={s.id}
                  onClick={() => pickSeries(s)}
                  style={{
                    padding: "6px 8px",
                    cursor: "pointer",
                    borderBottom: "1px solid #222",
                    color: "#ccc",
                    fontSize: 13,
                  }}
                >
                  {s.name} ({s.year_began || "?"})
                  {s.publisher && (
                    <span style={{ color: "#666" }}> — {s.publisher}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ color: "#ccc", fontSize: 13, marginBottom: 8 }}>
            {selectedSeries.name} ({selectedSeries.year_began || "?"})
            <button
              onClick={() => { setSelectedSeries(null); setIssues([]); setSelectedIssue(null); }}
              style={{
                marginLeft: 8,
                background: "none",
                border: "none",
                color: "#666",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              change
            </button>
          </div>
          <select
            value={selectedIssue || ""}
            onChange={(e) => setSelectedIssue(Number(e.target.value))}
            style={{
              width: "100%",
              padding: 8,
              background: "#222",
              border: "1px solid #444",
              borderRadius: 4,
              color: "#fff",
            }}
          >
            <option value="">Select issue...</option>
            {issues.map((i: any) => (
              <option key={i.id} value={i.id}>
                #{i.number} {i.publication_date ? `(${i.publication_date})` : ""}
              </option>
            ))}
          </select>

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              onClick={reassign}
              disabled={!selectedIssue || loading}
              style={{
                padding: "8px 16px",
                background: selectedIssue ? "#2563eb" : "#333",
                border: "none",
                borderRadius: 4,
                color: "#fff",
                cursor: selectedIssue ? "pointer" : "default",
              }}
            >
              {loading ? "Moving..." : "Move Scans Here"}
            </button>
            <button
              onClick={() => setOpen(false)}
              style={{
                padding: "8px 16px",
                background: "none",
                border: "1px solid #444",
                borderRadius: 4,
                color: "#888",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {error && <div style={{ color: "#ef4444", marginTop: 8, fontSize: 13 }}>{error}</div>}
    </div>
  );
}
