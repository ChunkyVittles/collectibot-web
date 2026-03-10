import { NextResponse } from "next/server";

export async function GET() {
  const info: Record<string, string> = {
    status: "ok",
    timestamp: new Date().toISOString(),
  };

  try {
    const store = (globalThis as any)[Symbol.for("__cloudflare-context__")];
    info.cfContext = store ? "exists" : "missing";
    if (store?.env?.HYPERDRIVE) {
      info.hyperdrive = "bound";
    }
  } catch (e: any) {
    info.cfContextError = e.message;
  }

  try {
    const pg = await import("pg");
    info.pgImport = "success";
    info.pgExports = Object.keys(pg).join(",");

    // Try Client instead of Pool
    try {
      const store = (globalThis as any)[Symbol.for("__cloudflare-context__")];
      const connStr = store?.env?.HYPERDRIVE?.connectionString || process.env.DATABASE_URL || "";

      const client = new pg.Client({ connectionString: connStr });
      await client.connect();
      const result = await client.query("SELECT 1 AS ok");
      info.dbConnected = "yes";
      info.dbResult = JSON.stringify(result.rows[0]);
      await client.end();
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
