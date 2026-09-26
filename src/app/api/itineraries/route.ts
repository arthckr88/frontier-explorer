import { planItineraries, readPreferences } from "@/server/queries/read";
import { coverLiveSearch } from "@/server/search/live";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origins = (url.searchParams.get("from") ?? "OAK").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
  const destinations = (url.searchParams.get("to") ?? "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
  const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  if (destinations.length === 0) return Response.json({ itineraries: [], notice: "Add a destination." });
  const preferences = await readPreferences();
  const origin = origins[0] ?? "";
  const destination = destinations[0] ?? "";
  const live =
    url.searchParams.has("from") &&
    url.searchParams.has("to") &&
    url.searchParams.has("date") &&
    origins.length === 1 &&
    destinations.length === 1 &&
    origin !== destination &&
    /^[A-Z]{3}$/.test(origin) &&
    /^[A-Z]{3}$/.test(destination) &&
    /^\d{4}-\d{2}-\d{2}$/.test(date);
  const coverage = live
    ? await coverLiveSearch({
        origin,
        destination,
        date,
        maxStops: preferences.maxStops,
        allowVegasOvernight: preferences.allowIntentionalStopover && preferences.preferVegasStopover,
      })
    : null;
  const result = await planItineraries({
    origins,
    destinations,
    date,
    preferences,
    unusual: url.searchParams.get("unusual") === "1",
  });
  return Response.json({ ...result, frontier: coverage });
}
