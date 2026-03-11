import { NextRequest, NextResponse } from "next/server";
import pool from "@/app/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { pending_id } = body;

  if (!pending_id) {
    return NextResponse.json({ error: "Missing pending_id" }, { status: 400 });
  }

  const pending = await pool.query(
    `SELECT * FROM pending_scans WHERE id = $1`,
    [pending_id]
  );

  if (pending.rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Delete from pending_scans
  await pool.query(`DELETE FROM pending_scans WHERE id = $1`, [pending_id]);

  return NextResponse.json({
    ok: true,
    front_image_path: pending.rows[0].front_image_path,
    back_image_path: pending.rows[0].back_image_path,
  });
}
