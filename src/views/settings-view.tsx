"use client";

import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, readSettings, SETTINGS_KEY, type SearchSettings } from "@/static/search";

export function SettingsView() {
  const [settings, setSettings] = useState<SearchSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setSettings(readSettings()));
  }, []);

  function save(event: React.FormEvent) {
    event.preventDefault();
    try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); setSaved(true); } catch { setSaved(false); }
  }

  return (
    <section className="mx-auto max-w-xl space-y-4">
      <header>
        <h1 className="text-2xl font-medium">Preferences</h1>
        <p className="text-sm text-[#8b9790]">New searches use these defaults. Fare mode highlights your preferred fare; all fare types remain visible. Saved in this browser.</p>
      </header>
      <form onSubmit={save} className="space-y-3 rounded-md border border-[#24302a] bg-[#12161b] p-4 text-sm">
        <label className="block">
          Fare mode
          <select
            name="fareMode"
            aria-label="Fare mode"
            value={settings.fareMode}
            onChange={(event) => setSettings({ ...settings, fareMode: event.target.value as SearchSettings["fareMode"] })}
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
            aria-label="Max stops"
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
