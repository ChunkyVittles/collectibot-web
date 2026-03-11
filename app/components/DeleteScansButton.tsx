"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteScansButton({ issueId }: { issueId: number }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    setDeleting(true);
    const res = await fetch("/api/scans/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issueId }),
    });

    if (res.ok) {
      router.refresh();
    } else {
      alert("Failed to delete scans");
    }
    setDeleting(false);
    setConfirming(false);
  }

  if (confirming) {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16 }}>
        <span style={{ color: "#f44", fontSize: 14 }}>Delete all scans for this issue?</span>
        <button
          onClick={handleDelete}
          disabled={deleting}
          style={{
            padding: "6px 16px",
            background: "#d32f2f",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: deleting ? "wait" : "pointer",
            fontSize: 13,
          }}
        >
          {deleting ? "Deleting..." : "Yes, delete"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          style={{
            padding: "6px 16px",
            background: "transparent",
            color: "#888",
            border: "1px solid #444",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      style={{
        marginTop: 16,
        padding: "8px 20px",
        background: "transparent",
        color: "#f44",
        border: "1px solid #f44",
        borderRadius: 4,
        cursor: "pointer",
        fontSize: 13,
      }}
    >
      Delete Scans
    </button>
  );
}
