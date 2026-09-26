import { adminAuthorized } from "@/server/auth";
import { JOBS, runJob, type JobName } from "@/server/jobs/run";

export async function POST(request: Request) {
  if (!process.env.ADMIN_SECRET) {
    return Response.json({ error: "ADMIN_SECRET is not configured, so sync triggers are closed." }, { status: 503 });
  }
  if (!adminAuthorized(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { job?: string } | null;
  const job = body?.job ?? "all";
  if (!JOBS.includes(job as JobName)) return Response.json({ error: "Unknown job." }, { status: 400 });
  const outcome = await runJob(job as JobName);
  return Response.json(outcome);
}
