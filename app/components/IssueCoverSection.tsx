"use client";

import { useState } from "react";
import UploadCoverButton from "./UploadCoverButton";
import ImageLightbox from "./ImageLightbox";

type Props = {
  issueId: number;
  issueSlug?: string | null;
  seriesName: string;
  issueNumber: string;
  publisherName?: string | null;
  publicationDate?: string | null;
  hasFront: boolean;
  hasBack: boolean;
  isAdmin: boolean;
};

export default function IssueCoverSection({
  issueId,
  issueSlug,
  seriesName,
  issueNumber,
  publisherName,
  publicationDate,
  hasFront: initialHasFront,
  hasBack: initialHasBack,
  isAdmin,
}: Props) {
  const context = [publisherName, publicationDate].filter(Boolean).join(", ");
  const frontAlt = `${seriesName} #${issueNumber} front cover${context ? ` — ${context}` : ""}`;
  const backAlt = `${seriesName} #${issueNumber} back cover${context ? ` — ${context}` : ""}`;
  const [cacheBust, setCacheBust] = useState(Date.now());
  const [hasFront, setHasFront] = useState(initialHasFront);
  const [hasBack, setHasBack] = useState(initialHasBack);

  // When the issue has a slug, use the descriptive image URL — keeps
  // the keywords (series, number, publisher, year, "front cover" /
  // "back cover") in the URL path itself for SEO.
  const frontSrc = issueSlug
    ? `/api/scans/image/${issueSlug}-front-cover.webp?t=${cacheBust}`
    : `/api/scans/image?issue=${issueId}&side=front&t=${cacheBust}`;
  const backSrc = issueSlug
    ? `/api/scans/image/${issueSlug}-back-cover.webp?t=${cacheBust}`
    : `/api/scans/image?issue=${issueId}&side=back&t=${cacheBust}`;

  function handleUploaded(side: "front" | "back") {
    setCacheBust(Date.now());
    if (side === "front") setHasFront(true);
    if (side === "back") setHasBack(true);
  }

  return (
    <>
      <div style={{ display: "flex", gap: 20, marginTop: 24 }}>
        <div style={{ flex: 1, textAlign: "center" }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "#ccc", margin: "0 0 8px 0" }}>Front Cover</h2>
          {hasFront ? (
            <ImageLightbox
              src={frontSrc}
              alt={frontAlt}
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
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "#ccc", margin: "0 0 8px 0" }}>Back Cover</h2>
          {hasBack ? (
            <ImageLightbox
              src={backSrc}
              alt={backAlt}
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
