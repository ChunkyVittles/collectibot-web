"use client";

import { useState } from "react";

type Props = {
  creditTypes: Array<{ key: string; label: string; count: number }>;
  publishers: Array<{ name: string; count: number }>;
  totalCredits: number;
};

// Client island for the credit-table filter UI. The actual table is rendered
// server-side (every row is in the SSR HTML, so search engines see it all);
// this component just emits CSS that hides rows whose data-* attributes
// don't match the current selection.
export default function CreatorFilters({ creditTypes, publishers, totalCredits }: Props) {
  const [type, setType] = useState<string>("all");
  const [publisher, setPublisher] = useState<string>("all");

  const cssRules: string[] = [];
  if (type !== "all") {
    // data-credit-type is space-separated when a row has multiple roles
    // (e.g. "pencils inks"); ~= matches if any token equals the selected type.
    cssRules.push(`tr.credit-row:not([data-credit-type~="${cssEscape(type)}"]) { display: none; }`);
  }
  if (publisher !== "all") {
    cssRules.push(`tr.credit-row:not([data-publisher="${cssEscape(publisher)}"]) { display: none; }`);
  }
  // Hide empty decade headers when all their rows are filtered out
  // — done by counting visible siblings via :has(), supported in modern browsers.
  if (cssRules.length > 0) {
    cssRules.push(`section.credit-decade:not(:has(tr.credit-row:not([style*="display: none"]))) { display: none; }`);
  }

  return (
    <>
      {cssRules.length > 0 && <style>{cssRules.join("\n")}</style>}
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          style={{ padding: "6px 10px", fontSize: 14, border: "1px solid #444", borderRadius: 4, background: "#1a1a1a", color: "#eee" }}
        >
          <option value="all">All types ({totalCredits.toLocaleString()})</option>
          {creditTypes.map((ct) => (
            <option key={ct.key} value={ct.key}>
              {ct.label} ({ct.count.toLocaleString()})
            </option>
          ))}
        </select>
        <select
          value={publisher}
          onChange={(e) => setPublisher(e.target.value)}
          style={{ padding: "6px 10px", fontSize: 14, border: "1px solid #444", borderRadius: 4, background: "#1a1a1a", color: "#eee" }}
        >
          <option value="all">All publishers</option>
          {publishers.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name} ({p.count.toLocaleString()})
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

// Minimal CSS-attribute escape: keep alnum, dash, underscore, space; escape
// everything else with a backslash. Good enough for the publisher/type
// values we emit (which come from our own DB).
function cssEscape(s: string): string {
  return s.replace(/["\\]/g, "\\$&");
}
