export type PassengerRoute = {
  origin: string;
  destination: string;
  passengers: number;
  departuresPerformed: number;
};

export function rankPassengerRoutes(routes: PassengerRoute[]): PassengerRoute[] {
  return [...routes].sort(
    (left, right) =>
      right.passengers - left.passengers ||
      left.origin.localeCompare(right.origin) ||
      left.destination.localeCompare(right.destination) ||
      right.departuresPerformed - left.departuresPerformed,
  );
}

export function passengerRoutesAreRanked(routes: PassengerRoute[]): boolean {
  for (let index = 1; index < routes.length; index += 1) {
    const previous = routes[index - 1];
    const current = routes[index];
    if (!previous || !current) return false;
    if (current.passengers > previous.passengers) return false;
    if (current.passengers === previous.passengers && current.origin < previous.origin) return false;
  }
  return routes.every((route) => route.passengers > 0 && route.departuresPerformed > 0 && route.origin !== route.destination);
}
