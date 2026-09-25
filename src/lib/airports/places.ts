export type Place =
  | { kind: "airports"; label: string; primary: string[]; nearby: string[]; used: string[] }
  | { kind: "region"; label: string; region: string }
  | { kind: "unknown"; label: string };

const GROUPS = [
  {
    label: "Bay Area",
    aliases: ["bay area", "sf bay", "san francisco bay"],
    primary: ["OAK", "SFO"],
    nearby: ["SJC"],
  },
  {
    label: "Los Angeles",
    aliases: ["la", "l.a.", "los angeles"],
    primary: ["LAX", "BUR"],
    nearby: ["SNA", "ONT"],
  },
  {
    label: "New York",
    aliases: ["nyc", "new york", "new york city"],
    primary: ["LGA", "JFK"],
    nearby: ["EWR"],
  },
  {
    label: "Orlando",
    aliases: ["orlando"],
    primary: ["MCO"],
    nearby: [],
  },
  {
    label: "South Florida",
    aliases: ["south florida"],
    primary: ["FLL", "MIA"],
    nearby: [],
  },
  {
    label: "Las Vegas",
    aliases: ["las vegas", "vegas"],
    primary: ["LAS"],
    nearby: [],
  },
] as const;

const REGIONS = [
  { label: "United States", region: "united_states", aliases: ["united states", "usa", "domestic"] },
  { label: "Mexico", region: "mexico", aliases: ["mexico"] },
  { label: "Caribbean", region: "caribbean", aliases: ["caribbean"] },
  { label: "Central America", region: "central_america", aliases: ["central america"] },
  { label: "South America", region: "south_america", aliases: ["south america"] },
  { label: "Canada", region: "canada", aliases: ["canada"] },
] as const;

export function resolvePlace(input: string, includeNearby: boolean): Place {
  const text = input.trim().toLowerCase();
  if (/^[a-z]{3}$/i.test(input.trim())) {
    const code = input.trim().toUpperCase();
    return { kind: "airports", label: code, primary: [code], nearby: [], used: [code] };
  }
  const group = GROUPS.find((item) => item.aliases.some((alias) => alias === text));
  if (group) {
    const used = includeNearby ? [...group.primary, ...group.nearby] : [...group.primary];
    return {
      kind: "airports",
      label: group.label,
      primary: [...group.primary],
      nearby: [...group.nearby],
      used,
    };
  }
  const region = REGIONS.find((item) => item.aliases.some((alias) => alias === text));
  if (region) return { kind: "region", label: region.label, region: region.region };
  return { kind: "unknown", label: input.trim() };
}

export type ParsedTrip = {
  raw: string;
  origin: Place | null;
  destination: Place | null;
};

export function parseTripQuery(input: string, includeNearby: boolean): ParsedTrip {
  const raw = input.trim();
  const parts = raw.split(/\s*(?:→|->| to )\s*/i);
  if (parts.length >= 2) {
    return {
      raw,
      origin: resolvePlace(parts[0] ?? "", includeNearby),
      destination: resolvePlace(parts.slice(1).join(" to "), includeNearby),
    };
  }
  return { raw, origin: null, destination: resolvePlace(raw, includeNearby) };
}

export function frontierSearchUrl(origin: string, destination: string, date?: string) {
  const url = new URL("https://www.flyfrontier.com/travel/book/flight/");
  url.searchParams.set("from", origin);
  url.searchParams.set("to", destination);
  if (date) url.searchParams.set("departureDate", date);
  return url.toString();
}
