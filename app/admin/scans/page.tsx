"use client";

import { useEffect, useState, useCallback } from "react";

interface PendingScan {
  id: number;
  front_image_path: string;
  back_image_path: string;
  extracted_title: string | null;
  extracted_issue: string | null;
  extracted_year: number | null;
  extracted_publisher: string | null;
  extracted_price: string | null;
  confidence_score: number;
  reason_for_review: string;
  created_at: string;
}

interface SeriesResult {
  id: number;
  name: string;
  year_began: number | null;
  year_ended: number | null;
  publisher: string | null;
  issue_count: number;
}

interface IssueResult {
  id: number;
  number: string;
  publication_date: string | null;
  key_date: string | null;
}

function ScanCard({
  scan,
  onDone,
}: {
  scan: PendingScan;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(scan.extracted_title || "");
  const [issueNumber, setIssueNumber] = useState(scan.extracted_issue || "");
  const [year, setYear] = useState(scan.extracted_year?.toString() || "");
  const [publisher, setPublisher] = useState(scan.extracted_publisher || "");

  const [seriesQuery, setSeriesQuery] = useState(scan.extracted_title || "");
  const [seriesResults, setSeriesResults] = useState<SeriesResult[]>([]);
  const [selectedSeries, setSelectedSeries] = useState<SeriesResult | null>(null);
  const [issues, setIssues] = useState<IssueResult[]>([]);
  const [selectedIssueId, setSelectedIssueId] = useState<number | null>(null);
  const [autoSearched, setAutoSearched] = useState(false);

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const searchSeries = useCallback(async (q: string) => {
    if (q.length < 2) {
      setSeriesResults([]);
      return;
    }
    const res = await fetch(`/api/admin/scans/search-series?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setSeriesResults(data.results || []);
  }, []);

  // Auto-match on mount: search series, pick best match, select issue
  useEffect(() => {
    if (autoSearched) return;
    if (!scan.extracted_title) return;
    setAutoSearched(true);

    (async () => {
      const res = await fetch(`/api/admin/scans/search-series?q=${encodeURIComponent(scan.extracted_title || "")}`);
      const data = await res.json();
      const results: SeriesResult[] = data.results || [];
      if (results.length === 0) {
        setSeriesResults(results);
        return;
      }

      // Pick best match: prefer year match, then first result
      let best = results[0];
      if (scan.extracted_year) {
        const yearMatch = results.find(
          (s) => s.year_began && s.year_began <= (scan.extracted_year || 0) &&
            (!s.year_ended || s.year_ended >= (scan.extracted_year || 0))
        );
        if (yearMatch) best = yearMatch;
      }

      // Auto-select this series and load its issues
      setSelectedSeries(best);
      setSeriesQuery(best.name);
      setSeriesResults([]);

      const issRes = await fetch(`/api/admin/scans/issues?seriesId=${best.id}`);
      const issData = await issRes.json();
      const allIssues: IssueResult[] = issData.issues || [];
      setIssues(allIssues);

      // Auto-select matching issue number
      if (issueNumber) {
        const match = allIssues.find((i) => i.number === issueNumber);
        if (match) setSelectedIssueId(match.id);
      }
    })();
  }, [autoSearched, scan.extracted_title, scan.extracted_year, issueNumber]);

  useEffect(() => {
    if (autoSearched && !selectedSeries) {
      const timer = setTimeout(() => searchSeries(seriesQuery), 300);
      return () => clearTimeout(timer);
    }
  }, [seriesQuery, searchSeries, autoSearched, selectedSeries]);

  const selectSeries = async (series: SeriesResult) => {
    setSelectedSeries(series);
    setSeriesResults([]);
    setSeriesQuery(series.name);
    loadIssues(series.id);
  };

  const loadIssues = async (seriesId: number) => {
    try {
      const res = await fetch(`/api/admin/scans/issues?seriesId=${seriesId}`);
      const data = await res.json();
      setIssues(data.issues || []);
      // Auto-select issue matching the extracted number
      if (issueNumber) {
        const match = (data.issues || []).find(
          (i: IssueResult) => i.number === issueNumber
        );
        if (match) setSelectedIssueId(match.id);
      }
    } catch {
      setIssues([]);
    }
  };

  const handleApprove = async () => {
    if (!selectedIssueId || !selectedSeries) {
      setStatus("Select a series and issue first");
      return;
    }
    setLoading(true);
    setStatus("Approving...");
    try {
      const slug = selectedSeries.name
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/[\s_]+/g, "-")
        .replace(/-+/g, "-")
        .trim();
      const res = await fetch("/api/admin/scans/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pending_id: scan.id,
          issue_id: selectedIssueId,
          series_slug: slug,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus("Approved!");
        setTimeout(onDone, 500);
      } else {
        setStatus(`Error: ${data.error}`);
      }
    } catch (e: unknown) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const handleReject = async () => {
    if (!confirm("Reject this scan? Files will be moved to /rejected/")) return;
    setLoading(true);
    setStatus("Rejecting...");
    try {
      const res = await fetch("/api/admin/scans/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pending_id: scan.id }),
      });
      const httpStatus = res.status;
      const data = await res.json();
      if (data.ok || httpStatus === 404) {
        setStatus(data.ok ? "Rejected" : "Already removed");
        setTimeout(onDone, 500);
      } else {
        setStatus(`Error: ${data.error}`);
      }
    } catch (e: unknown) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const imgUrl = (path: string) =>
    `/api/admin/scans/image?path=${encodeURIComponent(path)}`;

  return (
    <div
      style={{
        border: "1px solid #333",
        borderRadius: 8,
        padding: 20,
        marginBottom: 24,
        background: "#1a1a1a",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <div>
          <span
            style={{
              background: scan.confidence_score >= 60 ? "#a35c00" : "#8b0000",
              color: "#fff",
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 12,
              marginRight: 8,
            }}
          >
            {scan.confidence_score}%
          </span>
          <span style={{ color: "#f59e0b", fontSize: 13 }}>
            {scan.reason_for_review}
          </span>
        </div>
        <span style={{ color: "#666", fontSize: 12 }}>
          {new Date(scan.created_at).toLocaleString()}
        </span>
      </div>

      {/* Images side by side */}
      <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ color: "#888", fontSize: 12, marginBottom: 4 }}>Front</div>
          <img
            src={imgUrl(scan.front_image_path)}
            alt="Front cover"
            style={{ maxWidth: "100%", maxHeight: 400, borderRadius: 4 }}
          />
        </div>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ color: "#888", fontSize: 12, marginBottom: 4 }}>Back</div>
          <img
            src={imgUrl(scan.back_image_path)}
            alt="Back cover"
            style={{ maxWidth: "100%", maxHeight: 400, borderRadius: 4 }}
          />
        </div>
      </div>

      {/* Editable fields */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <label style={{ color: "#aaa", fontSize: 13 }}>
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={{ color: "#aaa", fontSize: 13 }}>
          Issue Number
          <input
            value={issueNumber}
            onChange={(e) => setIssueNumber(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={{ color: "#aaa", fontSize: 13 }}>
          Year
          <input
            value={year}
            onChange={(e) => setYear(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={{ color: "#aaa", fontSize: 13 }}>
          Publisher
          <input
            value={publisher}
            onChange={(e) => setPublisher(e.target.value)}
            style={inputStyle}
          />
        </label>
      </div>

      {/* Series search */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ color: "#aaa", fontSize: 13 }}>
          Search Series in Database
          <input
            value={seriesQuery}
            onChange={(e) => {
              setSeriesQuery(e.target.value);
              setSelectedSeries(null);
              setSelectedIssueId(null);
            }}
            placeholder="Type series name to search..."
            style={{ ...inputStyle, marginBottom: 0 }}
          />
        </label>

        {seriesResults.length > 0 && (
          <div
            style={{
              border: "1px solid #444",
              borderRadius: 4,
              maxHeight: 200,
              overflowY: "auto",
              marginTop: 4,
              background: "#222",
            }}
          >
            {seriesResults.map((s) => (
              <div
                key={s.id}
                onClick={() => selectSeries(s)}
                style={{
                  padding: "8px 12px",
                  cursor: "pointer",
                  borderBottom: "1px solid #333",
                  fontSize: 13,
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#333")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <strong>{s.name}</strong>
                <span style={{ color: "#888", marginLeft: 8 }}>
                  ({s.year_began}
                  {s.year_ended && s.year_ended !== s.year_began
                    ? `–${s.year_ended}`
                    : ""}
                  )
                </span>
                {s.publisher && (
                  <span style={{ color: "#666", marginLeft: 8 }}>
                    {s.publisher}
                  </span>
                )}
                <span style={{ color: "#555", marginLeft: 8 }}>
                  {s.issue_count} issues
                </span>
              </div>
            ))}
          </div>
        )}

        {selectedSeries && (
          <div
            style={{
              marginTop: 8,
              padding: "8px 12px",
              background: "#1e3a1e",
              borderRadius: 4,
              fontSize: 13,
            }}
          >
            Selected: <strong>{selectedSeries.name}</strong> (
            {selectedSeries.year_began}) — {selectedSeries.publisher}
          </div>
        )}
      </div>

      {/* Issue selector */}
      {selectedSeries && issues.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ color: "#aaa", fontSize: 13 }}>
            Select Issue
            <select
              value={selectedIssueId || ""}
              onChange={(e) => setSelectedIssueId(Number(e.target.value))}
              style={{
                ...inputStyle,
                cursor: "pointer",
              }}
            >
              <option value="">-- Select issue --</option>
              {issues.map((issue) => (
                <option key={issue.id} value={issue.id}>
                  #{issue.number}
                  {issue.publication_date
                    ? ` (${issue.publication_date})`
                    : issue.key_date
                      ? ` (${issue.key_date})`
                      : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button
          onClick={handleApprove}
          disabled={loading || !selectedIssueId}
          style={{
            background: selectedIssueId ? "#16a34a" : "#333",
            color: "#fff",
            border: "none",
            padding: "10px 24px",
            borderRadius: 6,
            cursor: selectedIssueId ? "pointer" : "not-allowed",
            fontWeight: "bold",
            fontSize: 14,
          }}
        >
          {!selectedSeries
            ? "Select a series first"
            : !selectedIssueId
              ? "Select an issue"
              : loading
                ? "Publishing..."
                : "Approve & Publish"}
        </button>
        <button
          onClick={handleReject}
          disabled={loading}
          style={{
            background: "#dc2626",
            color: "#fff",
            border: "none",
            padding: "10px 24px",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          Reject
        </button>
        {status && (
          <span style={{ color: "#888", fontSize: 13, marginLeft: 8 }}>
            {status}
          </span>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "8px 10px",
  marginTop: 4,
  background: "#222",
  border: "1px solid #444",
  borderRadius: 4,
  color: "#eee",
  fontSize: 14,
  boxSizing: "border-box",
};

export default function AdminScansPage() {
  const [scans, setScans] = useState<PendingScan[]>([]);
  const [loading, setLoading] = useState(true);

  const loadScans = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/scans");
      const data = await res.json();
      setScans(data.scans || []);
    } catch {
      setScans([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadScans();
  }, []);

  return (
    <div
      style={{
        maxWidth: 900,
        margin: "40px auto",
        padding: "0 20px",
        fontFamily: "system-ui",
        color: "#eee",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 24 }}>Scan Review</h1>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ color: "#888", fontSize: 13 }}>
            {scans.length} pending
          </span>
          <button
            onClick={loadScans}
            style={{
              background: "#333",
              color: "#ccc",
              border: "1px solid #555",
              padding: "6px 14px",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Refresh
          </button>
          <a
            href="/"
            style={{ color: "#888", fontSize: 13, textDecoration: "none" }}
          >
            Home
          </a>
        </div>
      </div>

      {loading && <p style={{ color: "#888" }}>Loading...</p>}

      {!loading && scans.length === 0 && (
        <p style={{ color: "#666", textAlign: "center", padding: 40 }}>
          No scans pending review.
        </p>
      )}

      {scans.map((scan) => (
        <ScanCard key={scan.id} scan={scan} onDone={loadScans} />
      ))}
    </div>
  );
}
