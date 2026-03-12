"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SetHeroButton({
  seriesId,
  issueId,
  isHero,
}: {
  seriesId: number;
  issueId: number;
  isHero: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (isHero) {
    return (
      <span style={{ padding: "8px 16px", color: "#22c55e", fontSize: 13 }}>
        Series Hero
      </span>
    );
  }

  const handleClick = async () => {
    setLoading(true);
    const res = await fetch("/api/series/hero", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seriesId, issueId }),
    });
    const data = await res.json();
    if (data.ok) {
      router.refresh();
    }
    setLoading(false);
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      style={{
        padding: "8px 16px",
        background: "none",
        border: "1px solid #666",
        color: "#aaa",
        borderRadius: 4,
        cursor: "pointer",
        marginLeft: 8,
        fontSize: 13,
      }}
    >
      {loading ? "Setting..." : "Set as Series Hero"}
    </button>
  );
}
