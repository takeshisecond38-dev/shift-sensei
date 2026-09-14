import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// pg v8 mishandles sslmode parsed from the connection string URL
// (throws a compatibility error). Strip sslmode from the URL and
// configure SSL explicitly so the pool works with Neon in production.
const connectionString = (() => {
  try {
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.delete("sslmode");
    return url.toString();
  } catch {
    return process.env.DATABASE_URL!;
  }
})();

export const pool = new Pool({
  connectionString,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : undefined,
});
export const db = drizzle(pool, { schema });
