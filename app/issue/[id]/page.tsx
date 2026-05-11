import pool from "@/app/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import DeleteScansButton from "@/app/components/DeleteScansButton";
import SwapCoversButton from "@/app/components/SwapCoversButton";
import ReassignScansButton from "@/app/components/ReassignScansButton";
import SetHeroButton from "@/app/components/SetHeroButton";
import IssueCoverSection from "@/app/components/IssueCoverSection";

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const result = await pool.query<{
    number: string;
    publication_date: string | null;
    key_date: string | null;
    variant_name: string | null;
    price: string | null;
    series_name: string;
    publisher_name: string | null;
    year_began: number | null;
  }>(
    `SELECT i.number, i.publication_date, i.key_date, i.variant_name, i.price,
            s.name AS series_name, p.name AS publisher_name, s.year_began
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

  return { title, description };
}

export default async function IssuePage({ params }: Props) {
  const { id } = await params;

  const issueRes = await pool.query(
    `SELECT i.id, i.number, i.series_id, i.key_date, i.publication_date,
            i.price, i.page_count, i.barcode, i.variant_name,
            s.name AS series_name, p.name AS publisher_name,
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

  return (
    <div style={{ maxWidth: 700, margin: "40px auto", padding: "0 20px", fontFamily: "system-ui" }}>
      <Link href={`/series/${issue.series_id}`} style={{ color: "#666", textDecoration: "none" }}>
        &larr; {issue.series_name}
      </Link>

      <h1 style={{ marginTop: 16, marginBottom: 4 }}>
        {issue.series_name} #{issue.number}
      </h1>
      <p style={{ color: "#666", margin: 0 }}>
        {issue.publisher_name && <>{issue.publisher_name} &middot; </>}
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

      <div style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Details</h2>
        <table style={{ fontSize: 14 }}>
          <tbody>
            {[
              ["Issue", `#${issue.number}`],
              ["Date", issue.publication_date || issue.key_date || "—"],
              ["Price", issue.price || "—"],
              ["Pages", issue.page_count || "—"],
              ["Barcode", issue.barcode || "—"],
            ].map(([label, value]) => (
              <tr key={label}>
                <td style={{ padding: "4px 16px 4px 0", color: "#888", whiteSpace: "nowrap" }}>{label}</td>
                <td style={{ padding: 4 }}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
