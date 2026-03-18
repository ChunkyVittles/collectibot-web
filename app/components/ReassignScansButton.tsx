"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ReassignScansButton({
  issueId,
  currentSeries,
  currentIssueNumber,
  currentSeriesId,
}: {
  issueId: number;
  currentSeries: string;
  currentIssueNumber: string;
  currentSeriesId: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"issue" | "series">("issue");

  // Issue number change (same series)
  const [sameSeriesIssues, setSameSeriesIssues] = useState<any[]>([]);
  const [selectedSameSeriesIssue, setSelectedSameSeriesIssue] = useState<number | null>(null);
  const [sameSeriesLoaded, setSameSeriesLoaded] = useState(false);

  // Series change
  const [seriesQuery, setSeriesQuery] = useState("");
  const [seriesResults, setSeriesResults] = useState<any[]>([]);
  const [selectedSeries, setSelectedSeries] = useState<any>(null);
  const [issues, setIssues] = useState<any[]>([]);
  const [selectedIssue, setSelectedIssue] = useState<number | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Load issues in current series for the dropdown
  const loadSameSeriesIssues = async () => {
    if (sameSeriesLoaded) return;
    const res = await fetch(`/api/admin/scans/issues?seriesId=${currentSeriesId}`);
    const data = await res.json();
    setSameSeriesIssues(data.issues || []);
    setSameSeriesLoaded(true);
  };

  const searchSeries = async () => {
    if (!seriesQuery.trim()) return;
    const res = await fetch(`/api/admin/scans/search-series?q=${encodeURIComponent(seriesQuery)}`);
    const data = await res.json();
    setSeriesResults(data.results || []);
    setSelectedSeries(null);
    setIssues([]);
    setSelectedIssue(null);
  };

  const pickSeries = async (series: any) => {
    setSelectedSeries(series);
    setSeriesResults([]);
    const res = await fetch(`/api/admin/scans/issues?seriesId=${series.id}`);
    const data = await res.json();
    setIssues(data.issues || []);
  };

  const doReassign = async (toIssueId: number) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/scans/reassign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromIssueId: issueId, toIssueId }),
      });
      const data = await res.json();
      if (data.ok) {
        window.location.href = `/issue/${toIssueId}`;
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
        onClick={() => { setOpen(true); loadSameSeriesIssues(); }}
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
        Edit
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
        width: "100%",
      }}
    >
      {/* Tab buttons */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => { setMode("issue"); loadSameSeriesIssues(); }}
          style={{
            padding: "6px 12px",
            background: mode === "issue" ? "#2563eb" : "#222",
            border: "none",
            borderRadius: 4,
            color: "#fff",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          Change Issue #
        </button>
        <button
          onClick={() => setMode("series")}
          style={{
            padding: "6px 12px",
            background: mode === "series" ? "#2563eb" : "#222",
            border: "none",
            borderRadius: 4,
            color: "#fff",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          Change Series
        </button>
        <button
          onClick={() => setOpen(false)}
          style={{
            padding: "6px 12px",
            background: "none",
            border: "1px solid #444",
            borderRadius: 4,
            color: "#666",
            cursor: "pointer",
            fontSize: 13,
            marginLeft: "auto",
          }}
        >
          Cancel
        </button>
      </div>

      {mode === "issue" && (
        <div>
          <div style={{ color: "#888", fontSize: 12, marginBottom: 8 }}>
            Current: {currentSeries} #{currentIssueNumber}
          </div>
          {!sameSeriesLoaded ? (
            <button
              onClick={loadSameSeriesIssues}
              style={{
                padding: "8px 16px",
                background: "#333",
                border: "none",
                borderRadius: 4,
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Load issues...
            </button>
          ) : (
            <>
              <select
                value={selectedSameSeriesIssue || ""}
                onChange={(e) => setSelectedSameSeriesIssue(Number(e.target.value))}
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
                {sameSeriesIssues.map((i: any) => (
                  <option key={i.id} value={i.id} disabled={i.id === issueId}>
                    #{i.number}
                    {i.variant_name ? ` — ${i.variant_name}` : ""}
                    {i.publication_date ? ` (${i.publication_date})` : ""}
                    {i.id === issueId ? " (current)" : ""}
                  </option>
                ))}
              </select>
              <button
                onClick={() => selectedSameSeriesIssue && doReassign(selectedSameSeriesIssue)}
                disabled={!selectedSameSeriesIssue || loading}
                style={{
                  marginTop: 12,
                  padding: "8px 16px",
                  background: selectedSameSeriesIssue ? "#2563eb" : "#333",
                  border: "none",
                  borderRadius: 4,
                  color: "#fff",
                  cursor: selectedSameSeriesIssue ? "pointer" : "default",
                }}
              >
                {loading ? "Moving..." : "Move Scans Here"}
              </button>
            </>
          )}
        </div>
      )}

      {mode === "series" && (
        <div>
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
                  onClick={() => {
                    setSelectedSeries(null);
                    setIssues([]);
                    setSelectedIssue(null);
                  }}
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
                    #{i.number}
                    {i.variant_name ? ` — ${i.variant_name}` : ""}
                    {i.publication_date ? ` (${i.publication_date})` : ""}
                  </option>
                ))}
              </select>

              <button
                onClick={() => selectedIssue && doReassign(selectedIssue)}
                disabled={!selectedIssue || loading}
                style={{
                  marginTop: 12,
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
            </>
          )}
        </div>
      )}

      {error && (
        <div style={{ color: "#ef4444", marginTop: 8, fontSize: 13 }}>
          {error}
        </div>
      )}
    </div>
  );
}
