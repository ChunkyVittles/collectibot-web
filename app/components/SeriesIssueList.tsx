"use client";

import { useState } from "react";
import Link from "next/link";

export type SeriesIssue = {
  id: number;
  number: string;
  variant_name: string | null;
  date: string;
  on_sale_date: string | null;
  price: string | null;
  has_scan: boolean;
  is_key: boolean;
  key_comment: string | null;
};

// One flat, chronological list of every issue in a series. Key issues are
// marked inline with a "Key" badge + their annotation rather than living in a
// separate section, and the "Only show keys" toggle filters the list down to
// just the keys.
export default function SeriesIssueList({
  issues,
  cacheBust,
}: {
  issues: SeriesIssue[];
  cacheBust: number;
}) {
  const [onlyKeys, setOnlyKeys] = useState(false);
  const keyCount = issues.filter((i) => i.is_key).length;
  const shown = onlyKeys ? issues.filter((i) => i.is_key) : issues;

  return (
    <section style={{ marginTop: 32 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
          borderBottom: "2px solid #333",
          paddingBottom: 4,
          marginBottom: 12,
        }}
      >
        <h2 style={{ fontSize: 18, margin: 0 }}>
          Issues
          <span style={{ fontWeight: 400, fontSize: 14, color: "#999", marginLeft: 8 }}>
            ({shown.length.toLocaleString()})
          </span>
        </h2>
        {keyCount > 0 && (
          <label
            style={{
              fontSize: 14,
              color: "#bbb",
              display: "flex",
              alignItems: "center",
              gap: 6,
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={onlyKeys}
              onChange={(e) => setOnlyKeys(e.target.checked)}
            />
            Only show keys ({keyCount})
          </label>
        )}
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th style={{ padding: "4px 8px 4px 0", width: 48 }}></th>
            <th style={{ padding: "4px 8px" }}>#</th>
            <th style={{ padding: "4px 8px", width: 120 }}>Date</th>
            <th style={{ padding: "4px 8px", width: 80 }}>Price</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((issue) => (
            <tr key={issue.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
              <td style={{ padding: "4px 8px 4px 0" }}>
                <Link href={`/issue/${issue.id}`} style={{ display: "block", textDecoration: "none" }}>
                  {issue.has_scan ? (
                    <img
                      src={`/api/scans/image?issue=${issue.id}&side=front&t=${cacheBust}`}
                      alt=""
                      style={{ width: 32, height: 48, objectFit: "cover", borderRadius: 2, verticalAlign: "middle" }}
                    />
                  ) : (
                    <div style={{ width: 32, height: 48, background: "#1a1a1a", borderRadius: 2, border: "1px solid #333" }} />
                  )}
                </Link>
              </td>
              <td style={{ padding: "4px 8px", fontWeight: 600 }}>
                <Link href={`/issue/${issue.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                  {issue.number}
                  {issue.variant_name && (
                    <span style={{ fontWeight: 400, color: "#999", fontSize: 12 }}> ({issue.variant_name})</span>
                  )}
                </Link>
                {issue.is_key && (
                  <span
                    style={{
                      display: "inline-block",
                      marginLeft: 8,
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 0.5,
                      textTransform: "uppercase",
                      color: "#8a6d00",
                      background: "#fff3cd",
                      border: "1px solid #f0d98c",
                      borderRadius: 3,
                      padding: "1px 5px",
                      verticalAlign: "middle",
                    }}
                  >
                    Key
                  </span>
                )}
                {issue.is_key && issue.key_comment && (
                  <div style={{ fontWeight: 400, fontSize: 12, color: "#999", marginTop: 2 }}>
                    {issue.key_comment}
                  </div>
                )}
              </td>
              <td style={{ padding: "4px 8px", color: "#666", verticalAlign: "top" }}>
                <Link href={`/issue/${issue.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                  {issue.date || "—"}
                  {issue.on_sale_date && (
                    <span style={{ color: "#888", fontSize: 12 }}> · on sale {issue.on_sale_date}</span>
                  )}
                </Link>
              </td>
              <td style={{ padding: "4px 8px", color: "#666", verticalAlign: "top" }}>
                <Link href={`/issue/${issue.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                  {issue.price || "—"}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {shown.length === 0 && (
        <p style={{ color: "#999", marginTop: 12 }}>No key issues in this series.</p>
      )}
    </section>
  );
}
