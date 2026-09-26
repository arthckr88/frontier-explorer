function toRad(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function toDeg(radians: number) {
  return (radians * 180) / Math.PI;
}

export function greatCircleArc(
  start: [number, number],
  end: [number, number],
  steps = 48,
): [number, number][] {
  const [lon1, lat1] = [toRad(start[0]), toRad(start[1])];
  const [lon2, lat2] = [toRad(end[0]), toRad(end[1])];
  const central = 2 * Math.asin(
    Math.sqrt(
      Math.sin((lat2 - lat1) / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
    ),
  );
  if (central === 0) return [start, end];

  const coords: [number, number][] = [];
  for (let index = 0; index <= steps; index += 1) {
    const fraction = index / steps;
    const a = Math.sin((1 - fraction) * central) / Math.sin(central);
    const b = Math.sin(fraction * central) / Math.sin(central);
    const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
    const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
    const z = a * Math.sin(lat1) + b * Math.sin(lat2);
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
    const lon = Math.atan2(y, x);
    coords.push([toDeg(lon), toDeg(lat)]);
  }
  return splitAntimeridian(coords);
}

function splitAntimeridian(coords: [number, number][]): [number, number][] {
  const output: [number, number][] = [];
  for (let index = 0; index < coords.length; index += 1) {
    const current = coords[index];
    const previous = output[output.length - 1];
    if (current && previous && Math.abs(current[0] - previous[0]) > 180) {
      const direction = current[0] > previous[0] ? -360 : 360;
      output.push([current[0] + direction, current[1]]);
    } else if (current) {
      output.push(current);
    }
  }
  return output;
}

export type RouteEdge = {
  origin: string;
  destination: string;
  status?: string;
};

export function reachable(
  origins: string[],
  edges: RouteEdge[],
  maxStops: number,
): Map<string, { stops: number; via: string[] }> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.origin) ?? [];
    list.push(edge.destination);
    adjacency.set(edge.origin, list);
  }
  const best = new Map<string, { stops: number; via: string[] }>();
  const queue: { airport: string; stops: number; via: string[] }[] = origins.map((airport) => ({
    airport,
    stops: -1,
    via: [],
  }));
  const seen = new Map<string, number>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (current.stops > maxStops) continue;
    const seenStops = seen.get(current.airport);
    if (seenStops != null && seenStops <= current.stops) continue;
    seen.set(current.airport, current.stops);
    if (current.stops >= 0 && !origins.includes(current.airport)) {
      best.set(current.airport, { stops: current.stops, via: current.via });
    }
    for (const next of adjacency.get(current.airport) ?? []) {
      queue.push({
        airport: next,
        stops: current.stops + 1,
        via: current.stops >= 0 ? [...current.via, current.airport] : current.via,
      });
    }
  }
  return best;
}
