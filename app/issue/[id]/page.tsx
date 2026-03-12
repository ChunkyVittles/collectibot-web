import pool from "@/app/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import DeleteScansButton from "@/app/components/DeleteScansButton";
import ReassignScansButton from "@/app/components/ReassignScansButton";

type Props = {
  params: Promise<{ id: string }>;
};

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

      {(hasFront || hasBack) && (
        <>
          <div style={{ display: "flex", gap: 20, marginTop: 24 }}>
            {hasFront && (
              <div style={{ flex: 1, textAlign: "center" }}>
                <div style={{ color: "#888", fontSize: 12, marginBottom: 4 }}>Front Cover</div>
                <img
                  src={`/api/scans/image?issue=${issue.id}&side=front`}
                  alt={`${issue.series_name} #${issue.number} front cover`}
                  style={{ width: "100%", borderRadius: 6, border: "1px solid #333" }}
                />
              </div>
            )}
            {hasBack && (
              <div style={{ flex: 1, textAlign: "center" }}>
                <div style={{ color: "#888", fontSize: 12, marginBottom: 4 }}>Back Cover</div>
                <img
                  src={`/api/scans/image?issue=${issue.id}&side=back`}
                  alt={`${issue.series_name} #${issue.number} back cover`}
                  style={{ width: "100%", borderRadius: 6, border: "1px solid #333" }}
                />
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", marginTop: 16 }}>
            <DeleteScansButton issueId={issue.id} />
            <ReassignScansButton issueId={issue.id} />
          </div>
        </>
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
