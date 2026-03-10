import { NextResponse } from "next/server";
import pool from "@/app/lib/db";

export async function GET() {
  const info: Record<string, string> = {
    status: "ok",
    timestamp: new Date().toISOString(),
  };

  try {
    const result = await pool.query("SELECT 1 AS ok");
    info.dbConnected = "yes";
    info.dbResult = JSON.stringify(result.rows[0]);
  } catch (err: unknown) {
    info.dbConnected = "no";
    info.dbError = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json(info);
}
