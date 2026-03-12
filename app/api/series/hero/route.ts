import { NextRequest, NextResponse } from "next/server";
import pool from "@/app/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { seriesId, issueId } = body;

  if (!seriesId || !issueId) {
    return NextResponse.json({ error: "Missing seriesId or issueId" }, { status: 400 });
  }

  await pool.query(
    `INSERT INTO series_settings (series_id, hero_issue_id, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (series_id)
     DO UPDATE SET hero_issue_id = $2, updated_at = NOW()`,
    [seriesId, issueId]
  );

  return NextResponse.json({ ok: true });
}
