import { planItineraries, readPreferences } from "@/server/queries/read";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origins = (url.searchParams.get("from") ?? "OAK").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
  const destinations = (url.searchParams.get("to") ?? "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
  const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  if (destinations.length === 0) return Response.json({ itineraries: [], notice: "Add a destination." });
  const preferences = await readPreferences();
  const result = await planItineraries({
    origins,
    destinations,
    date,
    preferences,
    unusual: url.searchParams.get("unusual") === "1",
  });
  return Response.json(result);
}
