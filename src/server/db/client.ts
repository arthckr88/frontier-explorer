import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/lib/env";
import * as schema from "@/server/db/schema";

type Database = PostgresJsDatabase<typeof schema>;

let client: ReturnType<typeof postgres> | null = null;
let database: Database | null = null;

export function getDb(): Database | null {
  const url = getEnv().DATABASE_URL;
  if (!url) return null;
  if (!database) {
    client = postgres(url, { max: 5, idle_timeout: 20, connect_timeout: 10 });
    database = drizzle(client, { schema });
  }
  return database;
}

export async function closeDb() {
  await client?.end({ timeout: 5 });
  client = null;
  database = null;
}

export { schema };
