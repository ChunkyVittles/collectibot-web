import { NextRequest, NextResponse } from "next/server";
import pool from "@/app/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { fromIssueId, toIssueId } = body;

  if (!fromIssueId || !toIssueId) {
    return NextResponse.json({ error: "Missing fromIssueId or toIssueId" }, { status: 400 });
  }

  // Verify target issue exists
  const target = await pool.query(`SELECT id FROM issues WHERE id = $1`, [toIssueId]);
  if (target.rows.length === 0) {
    return NextResponse.json({ error: "Target issue not found" }, { status: 404 });
  }

  // Delete any existing scans on the target issue (to avoid duplicates)
  await pool.query(`DELETE FROM scans WHERE issue_id = $1`, [toIssueId]);

  // Move scans from old issue to new issue
  const result = await pool.query(
    `UPDATE scans SET issue_id = $1 WHERE issue_id = $2`,
    [toIssueId, fromIssueId]
  );

  return NextResponse.json({ ok: true, moved: result.rowCount });
}
