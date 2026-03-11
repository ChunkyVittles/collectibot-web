import { NextResponse } from "next/server";
import pool from "@/app/lib/db";

export async function GET() {
  const result = await pool.query(
    `SELECT * FROM pending_scans ORDER BY created_at DESC`
  );
  return NextResponse.json({ scans: result.rows });
}
