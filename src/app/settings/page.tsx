import { readPreferences } from "@/server/queries/read";
import { savePreferences } from "@/server/actions/preferences";

export default async function SettingsPage() {
  const preferences = await readPreferences();
  return (
    <section className="mx-auto max-w-xl space-y-4">
      <header>
        <h1 className="text-2xl font-medium">Preferences</h1>
        <p className="text-sm text-[#8b9790]">These are personal planning defaults. They are not Frontier route facts. Home airports stay OAK, then SFO. SJC is nearby only.</p>
      </header>
      <form action={savePreferences} className="space-y-3 rounded-md border border-[#24302a] bg-[#12161b] p-4 text-sm">
        <label className="block">Fare mode
          <select name="fareMode" defaultValue={preferences.fareMode} className="mt-1 w-full rounded border border-[#24302a] bg-[#090b0d] px-2 py-2">
            <option value="standard">Standard</option>
            <option value="discount_den">Discount Den</option>
            <option value="gowild">GoWild</option>
          </select>
        </label>
        <label className="flex gap-2"><input type="checkbox" name="excludeRedEyes" defaultChecked={preferences.excludeRedEyes} /> Exclude red-eyes</label>
        <label className="flex gap-2"><input type="checkbox" name="allowIntentionalStopover" defaultChecked={preferences.allowIntentionalStopover} /> Allow intentional stopovers</label>
        <label className="flex gap-2"><input type="checkbox" name="preferVegasStopover" defaultChecked={preferences.preferVegasStopover} /> Prefer Las Vegas overnight</label>
        <label className="flex gap-2"><input type="checkbox" name="allowMultiDay" defaultChecked={preferences.allowMultiDay} /> Allow multi-day connections</label>
        <label className="flex gap-2"><input type="checkbox" name="includeNearby" defaultChecked={preferences.includeNearby} /> Include nearby airports (SJC, SNA, ONT, EWR)</label>
        <label className="block">Max stops
          <input name="maxStops" type="number" min={0} max={2} defaultValue={preferences.maxStops} className="mt-1 w-full rounded border border-[#24302a] bg-[#090b0d] px-2 py-2" />
        </label>
        <label className="block">Minimum connection minutes
          <input name="minConnectionMinutes" type="number" min={45} max={240} defaultValue={preferences.minConnectionMinutes} className="mt-1 w-full rounded border border-[#24302a] bg-[#090b0d] px-2 py-2" />
        </label>
        <p className="text-xs text-[#8b9790]">GoWild and Discount Den are separate modes. A GoWild fare is never priced as Discount Den plus GoWild.</p>
        <button className="rounded bg-[#3dbe7a] px-3 py-2 text-[#090b0d]" type="submit">Save</button>
      </form>
    </section>
  );
}
