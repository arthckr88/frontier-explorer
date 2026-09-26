export type UntimedEdge = {
  origin: string;
  destination: string;
  status: string;
  frequency: number | null;
};

export type UntimedPath = {
  airports: string[];
  statuses: string[];
  stops: number;
};

export function untimedPaths(
  edges: UntimedEdge[],
  origins: string[],
  destinations: string[],
  maxStops: number,
): UntimedPath[] {
  const adjacency = new Map<string, UntimedEdge[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.origin) ?? [];
    list.push(edge);
    adjacency.set(edge.origin, list);
  }
  const wanted = new Set(destinations);
  const results: UntimedPath[] = [];
  const maxLegs = maxStops + 1;

  function walk(path: UntimedEdge[]) {
    const last = path[path.length - 1];
    if (!last) return;
    if (wanted.has(last.destination)) {
      results.push({
        airports: [path[0]?.origin ?? last.origin, ...path.map((edge) => edge.destination)],
        statuses: path.map((edge) => edge.status),
        stops: path.length - 1,
      });
    }
    if (path.length >= maxLegs) return;
    const visited = new Set(path.flatMap((edge) => [edge.origin, edge.destination]));
    for (const next of adjacency.get(last.destination) ?? []) {
      if (visited.has(next.destination) && !wanted.has(next.destination)) continue;
      walk([...path, next]);
    }
  }

  for (const origin of origins) {
    for (const edge of adjacency.get(origin) ?? []) walk([edge]);
  }
  return results.slice(0, 40);
}
