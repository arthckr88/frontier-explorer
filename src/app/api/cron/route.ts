import { cronAuthorized } from "@/server/auth";
import { dueJobs, latestSuccessByJob, runJob, JOBS, type JobName } from "@/server/jobs/run";

export async function POST(request: Request) {
  if (!cronAuthorized(request)) {
    return Response.json({ error: "Cron endpoint is closed. Set CRON_SECRET and send Authorization: Bearer." }, { status: 401 });
  }
  const url = new URL(request.url);
  const requested = url.searchParams.get("job");
  if (requested && requested !== "due") {
    if (!JOBS.includes(requested as JobName)) {
      return Response.json({ error: "Unknown job." }, { status: 400 });
    }
    const outcome = await runJob(requested as JobName);
    return Response.json(outcome);
  }
  const due = await dueJobs(await latestSuccessByJob());
  const outcomes = [];
  for (const job of due) {
    if (job === "reconcile") continue;
    outcomes.push({ job, ...(await runJob(job)) });
  }
  if (due.includes("reconcile") || outcomes.length > 0) {
    outcomes.push({ job: "reconcile", ...(await runJob("reconcile")) });
  }
  return Response.json({ due, outcomes });
}
