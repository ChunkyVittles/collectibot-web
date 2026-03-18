"use client";

import { useState } from "react";
import Link from "next/link";
import ImageLightbox from "./ImageLightbox";

const ERA_OPTIONS = [
  "pioneer",
  "private mailing card",
  "undivided back",
  "divided back",
  "white border",
  "linen",
  "chrome",
];

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "6px 8px",
  background: "#222",
  border: "1px solid #444",
  borderRadius: 4,
  color: "#eee",
  fontSize: 14,
  boxSizing: "border-box",
};

type PostcardData = {
  id: number;
  description: string | null;
  publisher: string | null;
  postmark_city: string | null;
  postmark_state: string | null;
  postmark_country: string | null;
  postmark_year: number | null;
  era: string | null;
  artist: string | null;
  subject_tags: string[] | null;
};

export default function PostcardDetail({
  postcard,
  hasFront,
  hasBack,
  isAdmin,
  cacheBust,
}: {
  postcard: PostcardData;
  hasFront: boolean;
  hasBack: boolean;
  isAdmin: boolean;
  cacheBust: number;
}) {
  const pc = postcard;
  const t = cacheBust;

  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(pc.description || "");
  const [publisher, setPublisher] = useState(pc.publisher || "");
  const [postmarkCity, setPostmarkCity] = useState(pc.postmark_city || "");
  const [postmarkState, setPostmarkState] = useState(pc.postmark_state || "");
  const [postmarkCountry, setPostmarkCountry] = useState(pc.postmark_country || "");
  const [postmarkYear, setPostmarkYear] = useState(pc.postmark_year?.toString() || "");
  const [era, setEra] = useState(pc.era || "");
  const [artist, setArtist] = useState(pc.artist || "");
  const [tags, setTags] = useState((pc.subject_tags || []).join(", "));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const location = [postmarkCity, postmarkState, postmarkCountry].filter(Boolean).join(", ");
  const tagList = tags.split(",").map(t => t.trim()).filter(Boolean);

  const handleSave = async () => {
    setSaving(true);
    setStatus("Saving...");
    try {
      const res = await fetch("/api/admin/postcards/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: pc.id,
          description,
          publisher: publisher || null,
          postmark_city: postmarkCity || null,
          postmark_state: postmarkState || null,
          postmark_country: postmarkCountry || null,
          postmark_year: postmarkYear ? parseInt(postmarkYear) : null,
          era: era || null,
          artist: artist || null,
          subject_tags: tagList,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus("Saved");
        setEditing(false);
      } else {
        setStatus(`Error: ${data.error}`);
      }
    } catch (e: unknown) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setSaving(false);
  };

  return (
    <>
      {/* Title / Description */}
      {editing ? (
        <div style={{ marginTop: 16, marginBottom: 4 }}>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            style={{ ...inputStyle, fontSize: 20, fontWeight: 700, resize: "vertical" }}
          />
        </div>
      ) : (
        <h1 style={{ marginTop: 16, marginBottom: 4, fontSize: 22 }}>
          {description || "Vintage Postcard"}
        </h1>
      )}

      {/* Subtitle */}
      {!editing && (
        <p style={{ color: "#666", margin: 0 }}>
          {location && <>{location}</>}
          {postmarkYear && <> &middot; {postmarkYear}</>}
          {era && <> &middot; {era}</>}
        </p>
      )}

      {/* Edit button */}
      {isAdmin && !editing && (
        <button
          onClick={() => setEditing(true)}
          style={{ marginTop: 12, background: "#333", color: "#ccc", border: "1px solid #555", padding: "6px 14px", borderRadius: 4, cursor: "pointer", fontSize: 13 }}
        >
          Edit
        </button>
      )}

      {/* Front / Back images */}
      <div style={{ display: "flex", gap: 20, marginTop: 24 }}>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ color: "#888", fontSize: 12, marginBottom: 4 }}>Front</div>
          {hasFront ? (
            <ImageLightbox
              src={`/api/scans/image?postcard=${pc.id}&side=front&t=${t}`}
              alt={`${description || "Postcard"} front`}
              style={{ width: "100%", borderRadius: 6, border: "1px solid #333" }}
            />
          ) : (
            <div style={{ width: "100%", aspectRatio: "4/3", background: "#1a1a1a", borderRadius: 6, border: "1px dashed #444", display: "flex", alignItems: "center", justifyContent: "center", color: "#666", fontSize: 14 }}>
              No scan
            </div>
          )}
        </div>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ color: "#888", fontSize: 12, marginBottom: 4 }}>Back</div>
          {hasBack ? (
            <ImageLightbox
              src={`/api/scans/image?postcard=${pc.id}&side=back&t=${t}`}
              alt={`${description || "Postcard"} back`}
              style={{ width: "100%", borderRadius: 6, border: "1px solid #333" }}
            />
          ) : (
            <div style={{ width: "100%", aspectRatio: "4/3", background: "#1a1a1a", borderRadius: 6, border: "1px dashed #444", display: "flex", alignItems: "center", justifyContent: "center", color: "#666", fontSize: 14 }}>
              No scan
            </div>
          )}
        </div>
      </div>

      {/* Details */}
      <div style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Details</h2>
        {editing ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={{ color: "#aaa", fontSize: 13 }}>
              Era
              <select value={era} onChange={e => setEra(e.target.value)} style={inputStyle}>
                <option value="">Unknown</option>
                {ERA_OPTIONS.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </label>
            <label style={{ color: "#aaa", fontSize: 13 }}>
              Publisher
              <input value={publisher} onChange={e => setPublisher(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ color: "#aaa", fontSize: 13 }}>
              Artist
              <input value={artist} onChange={e => setArtist(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ color: "#aaa", fontSize: 13 }}>
              Postmark City
              <input value={postmarkCity} onChange={e => setPostmarkCity(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ color: "#aaa", fontSize: 13 }}>
              Postmark State
              <input value={postmarkState} onChange={e => setPostmarkState(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ color: "#aaa", fontSize: 13 }}>
              Postmark Country
              <input value={postmarkCountry} onChange={e => setPostmarkCountry(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ color: "#aaa", fontSize: 13 }}>
              Postmark Year
              <input value={postmarkYear} onChange={e => setPostmarkYear(e.target.value)} type="number" style={inputStyle} />
            </label>
          </div>
        ) : (
          <table style={{ fontSize: 14 }}>
            <tbody>
              {([
                ["Era", era],
                ["Publisher", publisher],
                ["Artist", artist],
                ["Postmark", location || null],
                ["Year", postmarkYear || null],
              ] as [string, string | null][])
                .filter(([, v]) => v != null && v !== "")
                .map(([label, value]) => (
                  <tr key={label}>
                    <td style={{ padding: "4px 16px 4px 0", color: "#888", whiteSpace: "nowrap" }}>{label}</td>
                    <td style={{ padding: 4 }}>{value}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Tags */}
      <div style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Subjects</h2>
        {editing ? (
          <label style={{ color: "#aaa", fontSize: 13 }}>
            Tags (comma-separated)
            <input value={tags} onChange={e => setTags(e.target.value)} style={inputStyle} />
          </label>
        ) : (
          tagList.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {tagList.map(tag => (
                <Link key={tag} href={`/postcards?tag=${encodeURIComponent(tag)}`} style={{ background: "#1a2a1a", color: "#8cb88c", padding: "4px 10px", borderRadius: 12, fontSize: 13, textDecoration: "none" }}>
                  {tag}
                </Link>
              ))}
            </div>
          )
        )}
      </div>

      {/* Save / Cancel */}
      {editing && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 20 }}>
          <button onClick={handleSave} disabled={saving} style={{ background: "#16a34a", color: "#fff", border: "none", padding: "10px 24px", borderRadius: 6, cursor: "pointer", fontWeight: "bold", fontSize: 14 }}>
            {saving ? "Saving..." : "Save"}
          </button>
          <button onClick={() => setEditing(false)} style={{ background: "#333", color: "#ccc", border: "1px solid #555", padding: "10px 24px", borderRadius: 6, cursor: "pointer", fontSize: 14 }}>
            Cancel
          </button>
          {status && <span style={{ color: "#888", fontSize: 13 }}>{status}</span>}
        </div>
      )}
    </>
  );
}
