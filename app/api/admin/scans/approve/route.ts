import { NextRequest, NextResponse } from "next/server";
import pool from "@/app/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { pending_id, issue_id, series_slug } = body;

  if (!pending_id || !issue_id || !series_slug) {
    return NextResponse.json(
      { error: "Missing pending_id, issue_id, or series_slug" },
      { status: 400 }
    );
  }

  // Get the pending scan record
  const pending = await pool.query(
    `SELECT * FROM pending_scans WHERE id = $1`,
    [pending_id]
  );

  if (pending.rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const scan = pending.rows[0];

  // Get issue number from DB for file naming
  const issueRow = await pool.query(
    `SELECT number FROM issues WHERE id = $1`,
    [issue_id]
  );
  const issueNumber = issueRow.rows[0]?.number || "0";

  // Insert into scans table (front + back)
  const frontUrl = `comics/${series_slug}/${issue_id}_F.webp`;
  const backUrl = `comics/${series_slug}/${issue_id}_B.webp`;

  await pool.query(
    `INSERT INTO scans (issue_id, scan_type, image_url, contributor_id, rights_granted)
     VALUES ($1, 'front_cover', $2, 1, 'true')`,
    [issue_id, frontUrl]
  );

  await pool.query(
    `INSERT INTO scans (issue_id, scan_type, image_url, contributor_id, rights_granted)
     VALUES ($1, 'back_cover', $2, 1, 'true')`,
    [issue_id, backUrl]
  );

  // Delete from pending_scans
  await pool.query(`DELETE FROM pending_scans WHERE id = $1`, [pending_id]);

  return NextResponse.json({
    ok: true,
    issue_id,
    series_slug,
    issue_number: issueNumber,
    front_image_path: scan.front_image_path,
    back_image_path: scan.back_image_path,
  });
}
