"use client";

import { useState } from "react";
import UploadCoverButton from "./UploadCoverButton";

type Props = {
  issueId: number;
  seriesName: string;
  issueNumber: string;
  hasFront: boolean;
  hasBack: boolean;
  isAdmin: boolean;
};

export default function IssueCoverSection({
  issueId,
  seriesName,
  issueNumber,
  hasFront: initialHasFront,
  hasBack: initialHasBack,
  isAdmin,
}: Props) {
  const [cacheBust, setCacheBust] = useState(Date.now());
  const [hasFront, setHasFront] = useState(initialHasFront);
  const [hasBack, setHasBack] = useState(initialHasBack);

  function handleUploaded(side: "front" | "back") {
    setCacheBust(Date.now());
    if (side === "front") setHasFront(true);
    if (side === "back") setHasBack(true);
  }

  return (
    <>
      <div style={{ display: "flex", gap: 20, marginTop: 24 }}>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ color: "#888", fontSize: 12, marginBottom: 4 }}>Front Cover</div>
          {hasFront ? (
            <img
              src={`/api/scans/image?issue=${issueId}&side=front&t=${cacheBust}`}
              alt={`${seriesName} #${issueNumber} front cover`}
              style={{ width: "100%", borderRadius: 6, border: "1px solid #333" }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                aspectRatio: "0.65",
                background: "#1a1a1a",
                borderRadius: 6,
                border: "1px dashed #444",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#666",
                fontSize: 14,
              }}
            >
              No scan
            </div>
          )}
        </div>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ color: "#888", fontSize: 12, marginBottom: 4 }}>Back Cover</div>
          {hasBack ? (
            <img
              src={`/api/scans/image?issue=${issueId}&side=back&t=${cacheBust}`}
              alt={`${seriesName} #${issueNumber} back cover`}
              style={{ width: "100%", borderRadius: 6, border: "1px solid #333" }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                aspectRatio: "0.65",
                background: "#1a1a1a",
                borderRadius: 6,
                border: "1px dashed #444",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#666",
                fontSize: 14,
              }}
            >
              No scan
            </div>
          )}
        </div>
      </div>

      {isAdmin && (
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <UploadCoverButton
            issueId={issueId}
            side="front"
            onUploaded={() => handleUploaded("front")}
          />
          <UploadCoverButton
            issueId={issueId}
            side="back"
            onUploaded={() => handleUploaded("back")}
          />
        </div>
      )}
    </>
  );
}
