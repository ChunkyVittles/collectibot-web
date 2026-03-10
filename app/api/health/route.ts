import { NextResponse } from "next/server";

export async function GET() {
  const info: Record<string, string> = {
    status: "ok",
    timestamp: new Date().toISOString(),
  };

  // Check cloudflare context
  try {
    const store = (globalThis as any)[Symbol.for("__cloudflare-context__")];
    info.cfContext = store ? "exists" : "missing";
    if (store?.env) {
      info.envKeys = Object.keys(store.env).join(",");
      if (store.env.HYPERDRIVE) {
        info.hyperdrive = "bound";
        info.hyperdriveConnStr = store.env.HYPERDRIVE.connectionString
          ? "set (length=" + store.env.HYPERDRIVE.connectionString.length + ")"
          : "not set";
      }
    }
  } catch (e: any) {
    info.cfContextError = e.message;
  }

  // Check DATABASE_URL
  info.dbUrlSet = process.env.DATABASE_URL ? "yes" : "no";

  // Try pg import
  try {
    const { Pool } = await import("pg");
    info.pgImport = "success";

    // Try connecting
    try {
      const store = (globalThis as any)[Symbol.for("__cloudflare-context__")];
      const connStr =
        store?.env?.HYPERDRIVE?.connectionString ||
        process.env.DATABASE_URL ||
        "";
      info.usingConnStr = connStr ? "length=" + connStr.length : "empty";

      const pool = new Pool({ connectionString: connStr });
      const result = await pool.query("SELECT 1 AS ok");
      info.dbConnected = "yes";
      info.dbResult = JSON.stringify(result.rows[0]);
      await pool.end();
    } catch (e: any) {
      info.dbConnected = "no";
      info.dbError = e.message;
    }
  } catch (e: any) {
    info.pgImport = "failed";
    info.pgError = e.message;
  }

  return NextResponse.json(info);
}
