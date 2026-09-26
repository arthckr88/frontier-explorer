"use client";

import { useState } from "react";

export function TripForm({
  action,
  from,
  to,
  date,
}: {
  action: string;
  from: string;
  to: string;
  date: string;
}) {
  const [pending, setPending] = useState(false);
  return (
    <form
      action={action}
      className="grid gap-3"
      onSubmit={() => setPending(true)}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-sm">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8b9790]">From</span>
          <input
            name="from"
            required
            minLength={3}
            maxLength={3}
            pattern="[A-Za-z]{3}"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            defaultValue={from}
            placeholder="OAK"
            aria-label="From"
            className="w-full rounded-md border border-[#24302a] bg-[#090b0d] px-3 py-3 text-base uppercase"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8b9790]">To</span>
          <input
            name="to"
            required
            minLength={3}
            maxLength={3}
            pattern="[A-Za-z]{3}"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            defaultValue={to}
            placeholder="LAS"
            aria-label="To"
            className="w-full rounded-md border border-[#24302a] bg-[#090b0d] px-3 py-3 text-base uppercase"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#8b9790]">Date</span>
          <input
            name="date"
            type="date"
            required
            defaultValue={date}
            aria-label="Date"
            className="w-full rounded-md border border-[#24302a] bg-[#090b0d] px-3 py-3 text-base"
          />
        </label>
      </div>
      <button
        className="rounded-md bg-[#3dbe7a] px-4 py-3 text-base font-medium text-[#090b0d] disabled:opacity-70"
        type="submit"
        disabled={pending}
      >
        {pending ? "Checking Frontier for this date…" : "Search"}
      </button>
      {pending ? (
        <p className="text-sm text-[#8b9790]">Looking up this route and date only. The rest of the network is not being crawled.</p>
      ) : null}
    </form>
  );
}
