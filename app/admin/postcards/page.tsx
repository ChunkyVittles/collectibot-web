"use client";

import { useEffect, useState } from "react";

interface Postcard {
  id: number;
  publisher: string | null;
  postmark_city: string | null;
  postmark_state: string | null;
  postmark_country: string | null;
  postmark_year: number | null;
  artist: string | null;
  subject_tags: string[] | null;
  description: string | null;
  era: string | null;
  front_image: string | null;
  back_image: string | null;
}

const ERA_OPTIONS = [
  "pioneer",
  "private mailing card",
  "undivided back",
  "divided back",
  "white border",
  "linen",
  "chrome",
];

function PostcardCard({
  postcard,
  onRemove,
}: {
  postcard: Postcard;
  onRemove: (id: number) => void;
}) {
  const [description, setDescription] = useState(postcard.description || "");
  const [publisher, setPublisher] = useState(postcard.publisher || "");
  const [postmarkCity, setPostmarkCity] = useState(postcard.postmark_city || "");
  const [postmarkState, setPostmarkState] = useState(postcard.postmark_state || "");
  const [postmarkCountry, setPostmarkCountry] = useState(postcard.postmark_country || "");
  const [postmarkYear, setPostmarkYear] = useState(postcard.postmark_year?.toString() || "");
  const [era, setEra] = useState(postcard.era || "");
  const [artist, setArtist] = useState(postcard.artist || "");
  const [tags, setTags] = useState((postcard.subject_tags || []).join(", "));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const imgUrl = (path: string | null) =>
    path ? `/api/admin/scans/image?path=${encodeURIComponent(path)}` : "";

  const handleSave = async () => {
    setSaving(true);
    setStatus("Saving...");
    try {
      const res = await fetch("/api/admin/postcards/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: postcard.id,
          description,
          publisher: publisher || null,
          postmark_city: postmarkCity || null,
          postmark_state: postmarkState || null,
          postmark_country: postmarkCountry || null,
          postmark_year: postmarkYear ? parseInt(postmarkYear) : null,
          era: era || null,
          artist: artist || null,
          subject_tags: tags.split(",").map(t => t.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      setStatus(data.ok ? "Saved" : `Error: ${data.error}`);
    } catch (e: unknown) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!confirm("Delete this postcard and its images?")) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/postcards/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: postcard.id }),
      });
      const data = await res.json();
      if (data.ok) {
        onRemove(postcard.id);
      } else {
        setStatus(`Error: ${data.error}`);
      }
    } catch (e: unknown) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setSaving(false);
  };

  return (
    <div style={{ border: "1px solid #333", borderRadius: 8, padding: 20, marginBottom: 24, background: "#1a1a1a" }}>
      {/* Images */}
      <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ color: "#888", fontSize: 12, marginBottom: 4 }}>Front</div>
          {postcard.front_image && (
            <img src={imgUrl(postcard.front_image)} alt="Front" style={{ maxWidth: "100%", maxHeight: 400, borderRadius: 4 }} />
          )}
        </div>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ color: "#888", fontSize: 12, marginBottom: 4 }}>Back</div>
          {postcard.back_image && (
            <img src={imgUrl(postcard.back_image)} alt="Back" style={{ maxWidth: "100%", maxHeight: 400, borderRadius: 4 }} />
          )}
        </div>
      </div>

      {/* Description */}
      <label style={{ color: "#aaa", fontSize: 13, display: "block", marginBottom: 12 }}>
        Description
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </label>

      {/* Grid of fields */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
        <label style={labelStyle}>
          Publisher
          <input value={publisher} onChange={e => setPublisher(e.target.value)} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Era
          <select value={era} onChange={e => setEra(e.target.value)} style={inputStyle}>
            <option value="">Unknown</option>
            {ERA_OPTIONS.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </label>
        <label style={labelStyle}>
          Artist
          <input value={artist} onChange={e => setArtist(e.target.value)} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Postmark City
          <input value={postmarkCity} onChange={e => setPostmarkCity(e.target.value)} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Postmark State
          <input value={postmarkState} onChange={e => setPostmarkState(e.target.value)} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Postmark Country
          <input value={postmarkCountry} onChange={e => setPostmarkCountry(e.target.value)} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Postmark Year
          <input value={postmarkYear} onChange={e => setPostmarkYear(e.target.value)} type="number" style={inputStyle} />
        </label>
        <label style={{ ...labelStyle, gridColumn: "span 2" }}>
          Subject Tags (comma-separated)
          <input value={tags} onChange={e => setTags(e.target.value)} style={inputStyle} />
        </label>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button onClick={handleSave} disabled={saving} style={{ background: "#16a34a", color: "#fff", border: "none", padding: "10px 24px", borderRadius: 6, cursor: "pointer", fontWeight: "bold", fontSize: 14 }}>
          {saving ? "Saving..." : "Save"}
        </button>
        <button onClick={handleDelete} disabled={saving} style={{ background: "#dc2626", color: "#fff", border: "none", padding: "10px 24px", borderRadius: 6, cursor: "pointer", fontSize: 14 }}>
          Delete
        </button>
        {status && <span style={{ color: "#888", fontSize: 13, marginLeft: 8 }}>{status}</span>}
        <span style={{ color: "#555", fontSize: 12, marginLeft: "auto" }}>#{postcard.id}</span>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "8px 10px",
  marginTop: 4,
  background: "#222",
  border: "1px solid #444",
  borderRadius: 4,
  color: "#eee",
  fontSize: 14,
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = { color: "#aaa", fontSize: 13 };

export default function AdminPostcardsPage() {
  const [postcards, setPostcards] = useState<Postcard[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPostcards = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/postcards");
      const data = await res.json();
      setPostcards(data.postcards || []);
    } catch {
      setPostcards([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadPostcards();
  }, []);

  return (
    <div style={{ maxWidth: 1000, margin: "40px auto", padding: "0 20px", fontFamily: "system-ui", color: "#eee" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Postcards</h1>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ color: "#888", fontSize: 13 }}>{postcards.length} postcards</span>
          <button onClick={loadPostcards} style={{ background: "#333", color: "#ccc", border: "1px solid #555", padding: "6px 14px", borderRadius: 4, cursor: "pointer", fontSize: 13 }}>
            Refresh
          </button>
          <a href="/admin/scans" style={{ color: "#888", fontSize: 13, textDecoration: "none" }}>Scans</a>
          <a href="/" style={{ color: "#888", fontSize: 13, textDecoration: "none" }}>Home</a>
        </div>
      </div>

      {loading && <p style={{ color: "#888" }}>Loading...</p>}

      {!loading && postcards.length === 0 && (
        <p style={{ color: "#666", textAlign: "center", padding: 40 }}>
          No postcards yet. Run the ingest script to add some.
        </p>
      )}

      {postcards.map(pc => (
        <PostcardCard
          key={pc.id}
          postcard={pc}
          onRemove={id => setPostcards(prev => prev.filter(p => p.id !== id))}
        />
      ))}
    </div>
  );
}
