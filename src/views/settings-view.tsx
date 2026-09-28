"use client";

import { useEffect, useState } from "react";

const KEY = "frontier-explorer-settings";

type Settings = {
  fareMode: "standard" | "discount_den" | "gowild";
  excludeRedEyes: boolean;
  maxStops: number;
};

const DEFAULTS: Settings = { fareMode: "standard", excludeRedEyes: true, maxStops: 0 };

export function SettingsView() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return;
    let next = DEFAULTS;
    try {
      next = { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      next = DEFAULTS;
    }
    queueMicrotask(() => setSettings(next));
  }, []);

  function save(event: React.FormEvent) {
    event.preventDefault();
    window.localStorage.setItem(KEY, JSON.stringify(settings));
    setSaved(true);
  }

  return (
    <section className="mx-auto max-w-xl space-y-4">
      <header>
        <h1 className="text-2xl font-medium">Preferences</h1>
        <p className="text-sm text-[#8b9790]">Personal planning defaults saved in this browser. They are not Frontier route facts. Home airports stay OAK, then SFO.</p>
      </header>
      <form onSubmit={save} className="space-y-3 rounded-md border border-[#24302a] bg-[#12161b] p-4 text-sm">
        <label className="block">
          Fare mode
          <select
            name="fareMode"
            value={settings.fareMode}
            onChange={(event) => setSettings({ ...settings, fareMode: event.target.value as Settings["fareMode"] })}
            className="mt-1 w-full rounded border border-[#24302a] bg-[#090b0d] px-2 py-2"
          >
            <option value="standard">Standard</option>
            <option value="discount_den">Discount Den</option>
            <option value="gowild">GoWild</option>
          </select>
        </label>
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={settings.excludeRedEyes}
            onChange={(event) => setSettings({ ...settings, excludeRedEyes: event.target.checked })}
          />
          Exclude red-eyes
        </label>
        <label className="block">
          Max stops
          <input
            type="number"
            min={0}
            max={2}
            value={settings.maxStops}
            onChange={(event) => setSettings({ ...settings, maxStops: Number(event.target.value) })}
            className="mt-1 w-full rounded border border-[#24302a] bg-[#090b0d] px-2 py-2"
          />
        </label>
        <p className="text-xs text-[#8b9790]">GoWild and Discount Den stay separate. A GoWild fare is never priced as Discount Den plus GoWild.</p>
        <button className="rounded bg-[#3dbe7a] px-3 py-2 text-[#090b0d]" type="submit">
          Save
        </button>
        {saved ? <p className="text-xs text-[#3dbe7a]">Saved in this browser.</p> : null}
      </form>
    </section>
  );
}
