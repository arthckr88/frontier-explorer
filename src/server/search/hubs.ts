export type DirectedPair = { origin: string; destination: string };

export type SearchLeg = { origin: string; destination: string; date: string };

/** Hubs already present as a stored leg out of the origin and into the destination. */
export function selectSearchHubs(
  edges: DirectedPair[],
  origins: string[],
  destinations: string[],
  limit: number,
): string[] {
  const originSet = new Set(origins);
  const destinationSet = new Set(destinations);
  const reachedFromOrigin = new Set<string>();
  const reachesDestination = new Set<string>();
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.destination, (degree.get(edge.destination) ?? 0) + 1);
    if (originSet.has(edge.origin) && !originSet.has(edge.destination) && !destinationSet.has(edge.destination)) {
      reachedFromOrigin.add(edge.destination);
    }
    if (destinationSet.has(edge.destination) && !destinationSet.has(edge.origin) && !originSet.has(edge.origin)) {
      reachesDestination.add(edge.origin);
    }
  }
  return [...reachedFromOrigin]
    .filter((code) => reachesDestination.has(code))
    .sort((left, right) => {
      if (left === "LAS") return -1;
      if (right === "LAS") return 1;
      return (degree.get(right) ?? 0) - (degree.get(left) ?? 0);
    })
    .slice(0, Math.max(0, limit));
}

export function legsForSearch(input: {
  origins: string[];
  destinations: string[];
  date: string;
  hubs: string[];
  fetchOvernightFromLas: boolean;
}): SearchLeg[] {
  const legs: SearchLeg[] = [];
  const seen = new Set<string>();
  const add = (origin: string, destination: string, date: string) => {
    if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination) || origin === destination) return;
    const key = `${origin}|${destination}|${date}`;
    if (seen.has(key)) return;
    seen.add(key);
    legs.push({ origin, destination, date });
  };
  for (const origin of input.origins) {
    for (const destination of input.destinations) add(origin, destination, input.date);
  }
  const nextDate = addDays(input.date, 1);
  for (const hub of input.hubs) {
    for (const origin of input.origins) add(origin, hub, input.date);
    for (const destination of input.destinations) {
      add(hub, destination, input.date);
      if (input.fetchOvernightFromLas && hub === "LAS" && nextDate) add(hub, destination, nextDate);
    }
  }
  return legs;
}

function addDays(iso: string, days: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
