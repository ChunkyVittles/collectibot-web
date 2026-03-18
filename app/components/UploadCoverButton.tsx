"use client";

import { useState, useRef } from "react";

type Props = {
  issueId: number;
  side: "front" | "back";
  onUploaded?: () => void;
};

export default function UploadCoverButton({ issueId, side, onUploaded }: Props) {
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const label = side === "front" ? "Front Cover" : "Back Cover";

  async function convertToWebp(file: File): Promise<Blob> {
    // createImageBitmap respects EXIF orientation and strips metadata
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No canvas context");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Conversion failed"))),
        "image/webp",
        0.92
      );
    });
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setStatus("Converting...");

    try {
      const webpBlob = await convertToWebp(file);

      setStatus("Uploading...");
      const form = new FormData();
      form.append("file", webpBlob, "cover.webp");
      form.append("issue_id", String(issueId));
      form.append("side", side);

      const res = await fetch("/api/scans/upload", { method: "POST", body: form });
      const data = await res.json();

      if (data.ok) {
        setStatus("Done!");
        onUploaded?.();
        setTimeout(() => setStatus(""), 2000);
      } else {
        setStatus(`Error: ${data.error}`);
      }
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div style={{ display: "inline-block" }}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={handleFile}
        style={{ display: "none" }}
        id={`upload-${side}-${issueId}`}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        style={{
          padding: "6px 12px",
          fontSize: 13,
          background: "#2563eb",
          color: "white",
          border: "none",
          borderRadius: 4,
          cursor: uploading ? "wait" : "pointer",
          opacity: uploading ? 0.6 : 1,
        }}
      >
        {uploading ? status : `Upload ${label}`}
      </button>
      {status && !uploading && (
        <span style={{ marginLeft: 8, fontSize: 12, color: status.startsWith("Error") ? "#f44" : "#4a4" }}>
          {status}
        </span>
      )}
    </div>
  );
}
