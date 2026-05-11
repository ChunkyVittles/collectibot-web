import { NextRequest, NextResponse } from "next/server";
import pool from "@/app/lib/db";
import { copyR2Object, deleteR2Object, getR2Config } from "@/app/lib/r2";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { pending_id, issue_id, series_slug } = body;

  if (!pending_id || !issue_id || !series_slug) {
    return NextResponse.json(
      { error: "Missing pending_id, issue_id, or series_slug" },
      { status: 400 }
    );
  }

  const pending = await pool.query(
    `SELECT * FROM pending_scans WHERE id = $1`,
    [pending_id]
  );

  if (pending.rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const scan = pending.rows[0];
  const r2 = getR2Config();

  const frontSrc = scan.front_image_path; // e.g. "pending/foo-front.webp"
  const backSrc = scan.back_image_path;
  const frontDst = `comics/${series_slug}/${issue_id}_F.webp`;
  const backDst = `comics/${series_slug}/${issue_id}_B.webp`;

  try {
    await copyR2Object(r2, frontSrc, frontDst);
    await copyR2Object(r2, backSrc, backDst);
  } catch (e) {
    return NextResponse.json(
      { error: `R2 copy failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }

  await pool.query(`DELETE FROM scans WHERE issue_id = $1`, [issue_id]);

  await pool.query(
    `INSERT INTO scans (issue_id, scan_type, image_url, contributor_id, rights_granted)
     VALUES ($1, 'front_cover', $2, 1, 'true')`,
    [issue_id, frontDst]
  );

  await pool.query(
    `INSERT INTO scans (issue_id, scan_type, image_url, contributor_id, rights_granted)
     VALUES ($1, 'back_cover', $2, 1, 'true')`,
    [issue_id, backDst]
  );

  await pool.query(`DELETE FROM pending_scans WHERE id = $1`, [pending_id]);

  try {
    await deleteR2Object(r2, frontSrc);
    await deleteR2Object(r2, backSrc);
  } catch {
    // Non-critical, ignore
  }

  return NextResponse.json({
    ok: true,
    issue_id,
    series_slug,
    front_url: frontDst,
    back_url: backDst,
  });
}
