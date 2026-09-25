import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { loadEnvFile } from "@/lib/env";

loadEnvFile();

async function main() {
  const url = process.env.DATABASE_URL ?? "postgresql://frontier:frontier@localhost:5432/frontier";
  const sql = postgres(url, { max: 1 });
  const database = drizzle(sql);
  await migrate(database, { migrationsFolder: "drizzle" });
  await sql.end();
  console.log("Migrations applied.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
