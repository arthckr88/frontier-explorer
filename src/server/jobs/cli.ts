import { closeDb } from "@/server/db/client";
import { loadEnvFile } from "@/lib/env";
import { JOBS, runJob, type JobName } from "@/server/jobs/run";

loadEnvFile();

const job = (process.argv[2] ?? "all") as JobName;
if (!JOBS.includes(job)) {
  console.error(`Unknown job "${job}". Use one of: ${JOBS.join(", ")}`);
  process.exit(1);
}

async function main() {
  const outcome = await runJob(job);
  console.log(JSON.stringify(outcome, null, 2));
  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  await closeDb();
  process.exit(1);
});
