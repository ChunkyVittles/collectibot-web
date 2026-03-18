"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type RecentScan = {
  issue_id?: number;
  pending_id?: number;
  postcard_id?: number;
  issue_number?: string;
  series_name?: string;
  series_id?: number;
  description?: string;
  postmark_city?: string;
  status: "matched" | "pending" | "postcard";
  front_image_path?: string;
};

function Logo() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Antenna */}
      <line x1="16" y1="2" x2="16" y2="7" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" />
      <circle cx="16" cy="2" r="1.5" fill="#4ade80" />
      {/* Head */}
      <rect x="6" y="7" width="20" height="16" rx="4" fill="#1a1a1a" stroke="#4ade80" strokeWidth="1.5" />
      {/* Eyes */}
      <circle cx="12" cy="15" r="2.5" fill="#4ade80" />
      <circle cx="20" cy="15" r="2.5" fill="#4ade80" />
      {/* Mouth / scanner line */}
      <line x1="11" y1="20" x2="21" y2="20" stroke="#4ade80" strokeWidth="1.5" strokeLinecap="round" />
      {/* Ears */}
      <rect x="3" y="12" width="3" height="6" rx="1.5" fill="#4ade80" opacity="0.6" />
      <rect x="26" y="12" width="3" height="6" rx="1.5" fill="#4ade80" opacity="0.6" />
      {/* Body hint */}
      <rect x="10" y="24" width="12" height="5" rx="2" fill="#1a1a1a" stroke="#4ade80" strokeWidth="1" opacity="0.5" />
    </svg>
  );
}

export default function RecentScans() {
  const [scans, setScans] = useState<RecentScan[]>([]);

  useEffect(() => {
    fetch("/api/scans/recent")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setScans(data); })
      .catch(() => {});
  }, []);

  return (
    <div
      style={{
        borderBottom: "1px solid #222",
        background: "#0a0a0a",
        padding: "10px 0",
        overflowX: "auto",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "0 20px",
          display: "flex",
          alignItems: "center",
          gap: 20,
        }}
      >
        {/* Logo + site name */}
        <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <Logo />
          <span style={{ fontSize: 16, fontWeight: 700, color: "#eee", letterSpacing: -0.5 }}>
            Collectibot
          </span>
        </Link>

        {/* Recent scans */}
        {scans.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, overflowX: "auto", flex: 1, paddingBottom: 2 }}>
            <span style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 1, flexShrink: 0 }}>
              Recent
            </span>
            {scans.map((s) => {
              const isPostcard = s.status === "postcard";
              const key = isPostcard
                ? `pc-${s.postcard_id}`
                : s.issue_id ? `i-${s.issue_id}` : `p-${s.pending_id}`;
              const href = isPostcard
                ? `/postcards/${s.postcard_id}`
                : s.status === "matched"
                  ? `/issue/${s.issue_id}`
                  : `/admin/scans`;
              const imgSrc = isPostcard
                ? `/api/scans/image?postcard=${s.postcard_id}&side=front`
                : s.status === "matched"
                  ? `/api/scans/image?issue=${s.issue_id}&side=front`
                  : `/api/scans/image?path=${encodeURIComponent(s.front_image_path || "")}`;
              const label = isPostcard
                ? (s.description || s.postmark_city || "Postcard")
                : s.series_name || "";

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
                      alt={label}
                      style={{
                        width: 64,
                        height: isPostcard ? 48 : 96,
                        objectFit: "cover",
                        borderRadius: 4,
                        border: s.status === "pending"
                          ? "1px solid #664400"
                          : isPostcard
                            ? "1px solid #446644"
                            : "1px solid #333",
                      }}
                    />
                    <div
                      style={{
                        fontSize: 10,
                        color: s.status === "pending" ? "#996600" : isPostcard ? "#8cb88c" : "#aaa",
                        marginTop: 4,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {label}
                    </div>
                    {!isPostcard && (
                      <div style={{ fontSize: 10, color: "#666" }}>
                        #{s.issue_number}
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
