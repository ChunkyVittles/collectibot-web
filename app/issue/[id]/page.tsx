import pool from "@/app/lib/db";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { cookies } from "next/headers";
import DeleteScansButton from "@/app/components/DeleteScansButton";
import SwapCoversButton from "@/app/components/SwapCoversButton";
import ReassignScansButton from "@/app/components/ReassignScansButton";
import SetHeroButton from "@/app/components/SetHeroButton";
import IssueCoverSection from "@/app/components/IssueCoverSection";

type Props = {
  params: Promise<{ id: string }>;
};

export const revalidate = 3600;

// Slug overrides for individual issues. Single-issue pilot for the slug
// migration — if the URL param matches a slug here, resolve it to the
// numeric id and render. If the URL param IS a numeric id that has a
// slug, 308-redirect to the slug URL so search engines pick up the
// canonical form. Will be replaced with a DB column when the full
// migration runs.
const SLUG_TO_ID: Record<string, string> = {
  "conan-the-barbarian-1-marvel-1970": "23540",
};
const ID_TO_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(SLUG_TO_ID).map(([slug, id]) => [id, slug]),
);

function resolveIssueId(param: string): string {
  return SLUG_TO_ID[param] ?? param;
}

export async function generateMetadata({ params }: Props) {
  const { id: param } = await params;
  const id = resolveIssueId(param);
  const result = await pool.query<{
    number: string;
    publication_date: string | null;
    key_date: string | null;
    variant_name: string | null;
    price: string | null;
    series_name: string;
    publisher_name: string | null;
    year_began: number | null;
    has_front_scan: boolean;
  }>(
    `SELECT i.number, i.publication_date, i.key_date, i.variant_name, i.price,
            s.name AS series_name, p.name AS publisher_name, s.year_began,
            EXISTS(SELECT 1 FROM scans WHERE issue_id = i.id AND scan_type = 'front_cover') AS has_front_scan
     FROM issues i
     JOIN series s ON i.series_id = s.id
     LEFT JOIN publishers p ON s.publisher_id = p.id
     WHERE i.id = $1`,
    [id]
  );
  if (result.rows.length === 0) return { title: "Issue Not Found - Collectibot" };
  const i = result.rows[0];

  const date = i.publication_date || i.key_date || "";
  const yearMatch = date.match(/(\d{4})/);
  const year = yearMatch ? yearMatch[1] : i.year_began ? String(i.year_began) : "";
  const dateLabel = i.publication_date || (year ? year : "");

  const titleBits = [`${i.series_name} #${i.number}`];
  if (dateLabel) titleBits.push(`(${dateLabel})`);
  if (i.variant_name) titleBits.push(`${i.variant_name}`);
  if (i.publisher_name) titleBits.push(`- ${i.publisher_name}`);
  const title = `${titleBits.join(" ")} - Collectibot`;

  const descBits = [`${i.series_name} #${i.number}`];
  if (dateLabel) descBits.push(`published ${dateLabel}`);
  if (i.publisher_name) descBits.push(`by ${i.publisher_name}`);
  if (i.price) descBits.push(`cover price ${i.price}`);
  const description = `${descBits.join(", ")}. Covers, creators, and details.`;

  const canonicalSlug = ID_TO_SLUG[id];
  // Index-eligible only when there's an actual front cover scan on the page
  // — overrides the site-wide noindex default from app/layout.tsx.
  const indexEligible = i.has_front_scan;
  return {
    title,
    description,
    ...(canonicalSlug
      ? { alternates: { canonical: `/issue/${canonicalSlug}` } }
      : {}),
    ...(indexEligible
      ? {
          robots: {
            index: true,
            follow: true,
            googleBot: { index: true, follow: true },
          },
        }
      : {}),
  };
}

// Display order + friendly labels for GCD credit_type values. Anything not
// listed here is shown under "Other credits" so we don't silently drop data
// if the credit_type vocabulary expands.
const CREDIT_TYPE_ORDER: Array<{ key: string; label: string }> = [
  { key: "script", label: "Writer" },
  { key: "pencils", label: "Pencils" },
  { key: "inks", label: "Inks" },
  { key: "colors", label: "Colors" },
  { key: "letters", label: "Letters" },
  { key: "editing", label: "Editing" },
];

type CreditRow = {
  credit_type: string;
  creator_id: number;
  creator_name: string;
};

type VariantRow = {
  id: number;
  number: string;
  variant_name: string | null;
};

type KeyCommentRow = {
  key_comment_1: string | null;
  key_comment_2: string | null;
  key_comment_3: string | null;
};

export default async function IssuePage({ params }: Props) {
  const { id: param } = await params;

  // If accessed by numeric id and we have a slug for it, 308-redirect
  // to the canonical slug URL so search engines see only one form.
  if (/^\d+$/.test(param) && ID_TO_SLUG[param]) {
    permanentRedirect(`/issue/${ID_TO_SLUG[param]}`);
  }

  const id = resolveIssueId(param);

  const issueRes = await pool.query(
    `SELECT i.id, i.number, i.volume, i.series_id, i.key_date, i.publication_date,
            i.on_sale_date, i.price, i.page_count, i.barcode, i.isbn,
            i.variant_name, i.variant_of_id,
            s.name AS series_name, p.name AS publisher_name, p.id AS publisher_id,
            s.year_began
     FROM issues i
     JOIN series s ON i.series_id = s.id
     LEFT JOIN publishers p ON s.publisher_id = p.id
     WHERE i.id = $1`,
    [id]
  );

  if (issueRes.rows.length === 0) return notFound();
  const issue = issueRes.rows[0];

  const scansRes = await pool.query(
    `SELECT scan_type FROM scans WHERE issue_id = $1`,
    [id]
  );
  const hasFront = scansRes.rows.some((r) => r.scan_type === "front_cover");
  const hasBack = scansRes.rows.some((r) => r.scan_type === "back_cover");

  const cookieStore = await cookies();
  const isAdmin = !!cookieStore.get("cb_auth");
  const heroRes = await pool.query(
    `SELECT hero_issue_id FROM series_settings WHERE series_id = $1`,
    [issue.series_id]
  );
  const isHero = heroRes.rows.length > 0 && heroRes.rows[0].hero_issue_id === issue.id;

  // Credits by role
  const creditsRes = await pool.query<CreditRow>(
    `SELECT ic.credit_type, c.id AS creator_id, c.name AS creator_name
     FROM issue_credits ic
     JOIN creators c ON ic.creator_id = c.id
     WHERE ic.issue_id = $1
     ORDER BY c.name`,
    [id]
  );
  const creditsByType = new Map<string, Array<{ id: number; name: string }>>();
  for (const row of creditsRes.rows) {
    if (!creditsByType.has(row.credit_type)) creditsByType.set(row.credit_type, []);
    creditsByType.get(row.credit_type)!.push({ id: row.creator_id, name: row.creator_name });
  }
  const seenTypes = new Set(CREDIT_TYPE_ORDER.map((c) => c.key));
  const otherCreditTypes = Array.from(creditsByType.keys()).filter((k) => !seenTypes.has(k));

  // Variants — siblings if this issue is a variant, children if it's a master.
  let masterIssue: VariantRow | null = null;
  let siblingVariants: VariantRow[] = [];
  let childVariants: VariantRow[] = [];

  if (issue.variant_of_id) {
    const masterRes = await pool.query<VariantRow>(
      `SELECT id, number, variant_name FROM issues WHERE id = $1`,
      [issue.variant_of_id]
    );
    masterIssue = masterRes.rows[0] || null;
    const sibsRes = await pool.query<VariantRow>(
      `SELECT id, number, variant_name FROM issues
       WHERE variant_of_id = $1 AND id != $2
       ORDER BY id`,
      [issue.variant_of_id, issue.id]
    );
    siblingVariants = sibsRes.rows;
  } else {
    const childRes = await pool.query<VariantRow>(
      `SELECT id, number, variant_name FROM issues WHERE variant_of_id = $1 ORDER BY id`,
      [issue.id]
    );
    childVariants = childRes.rows;
  }

  // Key issue annotations — only renders when key_comment_1 is populated
  // (filters out rows that are just CGC art-credit annotations).
  const keyRes = await pool.query<KeyCommentRow>(
    `SELECT key_comment_1, key_comment_2, key_comment_3
     FROM key_issues
     WHERE issue_id = $1 AND key_comment_1 IS NOT NULL
     LIMIT 1`,
    [id]
  );
  const keyNotes = keyRes.rows[0] || null;

  return (
    <div style={{ maxWidth: 700, margin: "40px auto", padding: "0 20px", fontFamily: "system-ui" }}>
      <Link href={`/series/${issue.series_id}`} style={{ color: "#666", textDecoration: "none" }}>
        &larr; {issue.series_name}
      </Link>

      <h1 style={{ marginTop: 16, marginBottom: 4 }}>
        {issue.series_name} #{issue.number}
      </h1>
      <p style={{ color: "#666", margin: 0 }}>
        {issue.publisher_id && issue.publisher_name && (
          <>
            <Link href={`/publisher/${issue.publisher_id}`} style={{ color: "inherit" }}>
              {issue.publisher_name}
            </Link>{" "}
            &middot;{" "}
          </>
        )}
        {issue.publication_date || issue.key_date || ""}
        {issue.variant_name && <> &middot; {issue.variant_name}</>}
      </p>

      <IssueCoverSection
        issueId={issue.id}
        seriesName={issue.series_name}
        issueNumber={issue.number}
        hasFront={hasFront}
        hasBack={hasBack}
        isAdmin={isAdmin}
      />

      {isAdmin && (hasFront || hasBack) && (
        <div style={{ display: "flex", alignItems: "flex-start", flexWrap: "wrap", marginTop: 16 }}>
          <DeleteScansButton issueId={issue.id} />
          {hasFront && hasBack && <SwapCoversButton issueId={issue.id} />}
          <ReassignScansButton
            issueId={issue.id}
            currentSeries={issue.series_name}
            currentIssueNumber={issue.number}
            currentSeriesId={issue.series_id}
          />
          <SetHeroButton
            seriesId={issue.series_id}
            issueId={issue.id}
            isHero={isHero}
          />
        </div>
      )}

      {/* Key issue notes */}
      {keyNotes && (
        <section
          style={{
            marginTop: 32,
            padding: "12px 16px",
            background: "#1a1a1a",
            border: "1px solid #333",
            borderLeft: "3px solid #d4a017",
            borderRadius: 4,
          }}
        >
          <h2 style={{ fontSize: 14, color: "#d4a017", margin: "0 0 6px 0", textTransform: "uppercase", letterSpacing: 0.5 }}>
            Key issue
          </h2>
          {[keyNotes.key_comment_1, keyNotes.key_comment_2, keyNotes.key_comment_3]
            .filter(Boolean)
            .map((c, idx) => (
              <p key={idx} style={{ margin: "4px 0", fontSize: 14, color: "#eee" }}>
                {c}
              </p>
            ))}
        </section>
      )}

      {/* Credits by role */}
      {creditsRes.rows.length > 0 && (
        <section style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Credits</h2>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px", fontSize: 14, margin: 0 }}>
            {CREDIT_TYPE_ORDER.flatMap(({ key, label }) => {
              const creators = creditsByType.get(key);
              if (!creators || creators.length === 0) return [];
              return [
                <dt key={`${key}-dt`} style={{ color: "#888" }}>{label}</dt>,
                <dd key={`${key}-dd`} style={{ margin: 0 }}>
                  {creators.map((c, idx) => (
                    <span key={c.id}>
                      <Link href={`/creator/${c.id}`} style={{ color: "inherit" }}>
                        {c.name}
                      </Link>
                      {idx < creators.length - 1 ? ", " : ""}
                    </span>
                  ))}
                </dd>,
              ];
            })}
            {otherCreditTypes.flatMap((key) => {
              const creators = creditsByType.get(key)!;
              return [
                <dt key={`${key}-dt`} style={{ color: "#888", textTransform: "capitalize" }}>{key}</dt>,
                <dd key={`${key}-dd`} style={{ margin: 0 }}>
                  {creators.map((c, idx) => (
                    <span key={c.id}>
                      <Link href={`/creator/${c.id}`} style={{ color: "inherit" }}>
                        {c.name}
                      </Link>
                      {idx < creators.length - 1 ? ", " : ""}
                    </span>
                  ))}
                </dd>,
              ];
            })}
          </dl>
        </section>
      )}

      {/* Variants */}
      {(masterIssue || siblingVariants.length > 0 || childVariants.length > 0) && (
        <section style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Variants</h2>
          {masterIssue && (
            <p style={{ fontSize: 14, margin: "0 0 8px 0", color: "#bbb" }}>
              This is a variant of{" "}
              <Link href={`/issue/${masterIssue.id}`} style={{ color: "inherit", fontWeight: 600 }}>
                #{masterIssue.number}
                {masterIssue.variant_name && ` (${masterIssue.variant_name})`}
              </Link>
              .
            </p>
          )}
          {(siblingVariants.length > 0 || childVariants.length > 0) && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {(siblingVariants.length > 0 ? siblingVariants : childVariants).map((v) => (
                <li key={v.id} style={{ padding: "4px 0", fontSize: 14 }}>
                  <Link href={`/issue/${v.id}`} style={{ color: "inherit" }}>
                    #{v.number}
                    {v.variant_name && <span style={{ color: "#888" }}> — {v.variant_name}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Details */}
      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Details</h2>
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px", fontSize: 14, margin: 0 }}>
          <dt style={{ color: "#888", whiteSpace: "nowrap" }}>Issue</dt>
          <dd style={{ margin: 0 }}>#{issue.number}</dd>

          {issue.volume && (
            <>
              <dt style={{ color: "#888" }}>Volume</dt>
              <dd style={{ margin: 0 }}>{issue.volume}</dd>
            </>
          )}

          {(issue.publication_date || issue.key_date) && (
            <>
              <dt style={{ color: "#888" }}>Date</dt>
              <dd style={{ margin: 0 }}>{issue.publication_date || issue.key_date}</dd>
            </>
          )}

          {issue.on_sale_date && issue.on_sale_date !== issue.publication_date && (
            <>
              <dt style={{ color: "#888" }}>On sale</dt>
              <dd style={{ margin: 0 }}>{issue.on_sale_date}</dd>
            </>
          )}

          {issue.price && (
            <>
              <dt style={{ color: "#888" }}>Price</dt>
              <dd style={{ margin: 0 }}>{issue.price}</dd>
            </>
          )}

          {issue.page_count && (
            <>
              <dt style={{ color: "#888" }}>Pages</dt>
              <dd style={{ margin: 0 }}>{issue.page_count}</dd>
            </>
          )}

          {issue.barcode && (
            <>
              <dt style={{ color: "#888" }}>Barcode</dt>
              <dd style={{ margin: 0 }}>{issue.barcode}</dd>
            </>
          )}

          {issue.isbn && (
            <>
              <dt style={{ color: "#888" }}>ISBN</dt>
              <dd style={{ margin: 0 }}>{issue.isbn}</dd>
            </>
          )}

          {issue.variant_name && (
            <>
              <dt style={{ color: "#888" }}>Variant</dt>
              <dd style={{ margin: 0 }}>{issue.variant_name}</dd>
            </>
          )}
        </dl>
      </section>
    </div>
  );
}
