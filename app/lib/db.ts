import { Pool } from "pg";

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

// Pool must be created per-request in Workers (no persistent state between requests)
const pool = {
  query(...args: Parameters<Pool["query"]>) {
    const p = new Pool({ connectionString: getConnectionString() });
    return p.query(...args).finally(() => p.end());
  },
};

export default pool;
