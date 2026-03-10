import { NextResponse } from "next/server";

export async function GET() {
  const info: Record<string, string> = {
    status: "ok",
    dbUrlSet: process.env.DATABASE_URL ? "yes" : "no",
    timestamp: new Date().toISOString(),
  };

  // Try importing pg dynamically to see if it fails
  try {
    const { Pool } = await import("pg");
    info.pgImport = "success";

    try {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const result = await pool.query("SELECT 1 AS ok");
      info.dbConnected = "yes";
      info.dbResult = JSON.stringify(result.rows[0]);
      await pool.end();
    } catch (err: unknown) {
      info.dbConnected = "no";
      info.dbError = err instanceof Error ? err.message : String(err);
    }
  } catch (err: unknown) {
    info.pgImport = "failed";
    info.pgImportError = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json(info);
}
