"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type RecentScan = {
  issue_id?: number;
  pending_id?: number;
  issue_number: string;
  series_name: string;
  series_id?: number;
  status: "matched" | "pending";
  front_image_path?: string;
};

export default function RecentScans() {
  const [scans, setScans] = useState<RecentScan[]>([]);

  useEffect(() => {
    fetch("/api/scans/recent")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setScans(data); })
      .catch(() => {});
  }, []);

  if (scans.length === 0) return null;

  return (
    <div
      style={{
        borderBottom: "1px solid #222",
        background: "#0a0a0a",
        padding: "12px 0",
        overflowX: "auto",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "0 20px",
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: "#666",
            textTransform: "uppercase",
            letterSpacing: 1,
            marginBottom: 8,
          }}
        >
          Recently Scanned
        </div>
        <div
          style={{
            display: "flex",
            gap: 12,
            overflowX: "auto",
            paddingBottom: 4,
          }}
        >
          {scans.map((s) => {
            const key = s.issue_id ? `i-${s.issue_id}` : `p-${s.pending_id}`;
            const href = s.status === "matched"
              ? `/issue/${s.issue_id}`
              : `/admin`;
            const imgSrc = s.status === "matched"
              ? `/api/scans/image?issue=${s.issue_id}&side=front`
              : `/api/scans/image?path=${encodeURIComponent(s.front_image_path || "")}`;

            return (
              <Link
                key={key}
                href={href}
                style={{ textDecoration: "none", flexShrink: 0 }}
              >
                <div
                  style={{
                    width: 64,
                    textAlign: "center",
                  }}
                >
                  <img
                    src={imgSrc}
                    alt={`${s.series_name} #${s.issue_number}`}
                    style={{
                      width: 64,
                      height: 96,
                      objectFit: "cover",
                      borderRadius: 4,
                      border: s.status === "pending"
                        ? "1px solid #664400"
                        : "1px solid #333",
                    }}
                  />
                  <div
                    style={{
                      fontSize: 10,
                      color: s.status === "pending" ? "#996600" : "#aaa",
                      marginTop: 4,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {s.series_name}
                  </div>
                  <div style={{ fontSize: 10, color: "#666" }}>
                    #{s.issue_number}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
