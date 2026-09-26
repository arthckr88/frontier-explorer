"use client";

import { useState } from "react";

const JOBS = ["priority", "schedules", "announcements", "programs", "popularity", "reconcile", "all"];

export default function AdminPage() {
  const [secret, setSecret] = useState("");
  const [output, setOutput] = useState("Sync actions stay closed unless ADMIN_SECRET matches.");
  const [busy, setBusy] = useState(false);

  async function run(job: string) {
    setBusy(true);
    setOutput("Running…");
    try {
      const response = await fetch("/api/admin/sync", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({ job }),
      });
      const body = await response.text();
      setOutput(`${response.status}\n${body}`);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-3xl space-y-4">
      <header>
        <h1 className="text-2xl font-medium">Admin</h1>
        <p className="text-sm text-[#8b9790]">Triggers the same server jobs as cron. The secret is not stored in the repo. This view does not show Frontier credentials because the app does not collect them.</p>
      </header>
      <input
        type="password"
        value={secret}
        onChange={(event) => setSecret(event.target.value)}
        placeholder="Admin secret"
        className="w-full rounded border border-[#24302a] bg-[#12161b] px-3 py-2 text-sm"
      />
      <div className="flex flex-wrap gap-2">
        {JOBS.map((job) => (
          <button key={job} type="button" disabled={busy} onClick={() => run(job)} className="rounded border border-[#24302a] px-3 py-2 text-sm disabled:opacity-50">
            {job}
          </button>
        ))}
      </div>
      <pre className="overflow-auto rounded border border-[#24302a] bg-[#090b0d] p-3 text-xs text-[#c5d0c9]">{output}</pre>
    </section>
  );
}
