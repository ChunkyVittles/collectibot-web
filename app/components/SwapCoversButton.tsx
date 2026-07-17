"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SwapCoversButton({ issueId }: { issueId: number }) {
  const [swapping, setSwapping] = useState(false);
  const router = useRouter();

  async function handleSwap() {
    setSwapping(true);
    const res = await fetch("/api/scans/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issueId }),
    });

    if (res.ok) {
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to swap covers");
    }
    setSwapping(false);
  }

  return (
    <button
      onClick={handleSwap}
      disabled={swapping}
      style={{
        padding: "8px 20px",
        background: "transparent",
        color: "#666",
        border: "1px solid #666",
        borderRadius: 4,
        cursor: swapping ? "wait" : "pointer",
        fontSize: 13,
      }}
    >
      {swapping ? "Swapping..." : "Swap Covers"}
    </button>
  );
}
