import { NextResponse } from "next/server";
import pool from "@/app/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const result = await pool.query(
    `SELECT * FROM pending_scans ORDER BY created_at DESC`
  );
  return NextResponse.json(
    { scans: result.rows },
    { headers: { "Cache-Control": "no-store, must-revalidate" } }
  );
}
