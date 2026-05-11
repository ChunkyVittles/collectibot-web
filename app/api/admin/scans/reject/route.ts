import { NextRequest, NextResponse } from "next/server";
import pool from "@/app/lib/db";
import { deleteR2Object, getR2Config } from "@/app/lib/r2";

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

  const { front_image_path, back_image_path } = pending.rows[0];

  await pool.query(`DELETE FROM pending_scans WHERE id = $1`, [pending_id]);

  const r2 = getR2Config();
  const r2Errors: string[] = [];
  for (const key of [front_image_path, back_image_path]) {
    if (!key) continue;
    try {
      await deleteR2Object(r2, key);
    } catch (e) {
      r2Errors.push(`${key}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    front_image_path,
    back_image_path,
    r2_errors: r2Errors.length ? r2Errors : undefined,
  });
}
