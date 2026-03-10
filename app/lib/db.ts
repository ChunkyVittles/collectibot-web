import postgres from "postgres";

function getConnectionString(): string {
  try {
    const store = (globalThis as any)[Symbol.for("__cloudflare-context__")];
    if (store?.env?.HYPERDRIVE?.connectionString) {
      return store.env.HYPERDRIVE.connectionString;
    }
  } catch {
    // Not in Cloudflare context
  }
  return process.env.DATABASE_URL || "";
}

// Wrapper that provides a pg-compatible query interface using postgres.js
const pool = {
  async query<R = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: R[]; rowCount: number }> {
    const sql = postgres(getConnectionString(), {
      max: 1,
      idle_timeout: 0,
      connect_timeout: 10,
    });
    try {
      const result = await sql.unsafe<R[]>(text, values as any[]);
      return { rows: Array.from(result), rowCount: result.length };
    } finally {
      await sql.end();
    }
  },
};

export default pool;
