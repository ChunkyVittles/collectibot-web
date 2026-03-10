import { Pool, QueryResult, QueryResultRow } from "pg";

function getConnectionString(): string {
  // In Cloudflare Workers with Hyperdrive, get connection string from the binding
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

const pool = {
  async query<R extends QueryResultRow = any>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<R>> {
    const p = new Pool({ connectionString: getConnectionString() });
    try {
      return await p.query<R>(text, values);
    } finally {
      await p.end();
    }
  },
};

export default pool;
