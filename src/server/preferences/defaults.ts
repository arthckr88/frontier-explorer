import type { UserPreferences } from "@/types/domain";

export const PRIORITY_AIRPORTS = [
  "OAK",
  "SFO",
  "LAS",
  "LAX",
  "BUR",
  "JFK",
  "LGA",
  "MCO",
  "FLL",
  "MIA",
] as const;

export const defaultPreferences: UserPreferences = {
  homeAirports: ["OAK", "SFO"],
  homePriority: ["OAK"],
  heavyInterest: [...PRIORITY_AIRPORTS],
  includeNearby: false,
  excludeRedEyes: true,
  maxStops: 1,
  minConnectionMinutes: 60,
  allowLongConnection: true,
  allowIntentionalStopover: true,
  allowMultiDay: false,
  preferVegasStopover: true,
  maxJourneyHours: 36,
  fareMode: "standard",
  programs: { gowild: true, discountDen: true },
};

export const metroSeeds = [
  {
    code: "BAY",
    name: "Bay Area",
    primaryAirports: ["OAK", "SFO"],
    nearbyAirports: ["SJC"],
  },
  {
    code: "LA",
    name: "Los Angeles",
    primaryAirports: ["LAX", "BUR"],
    nearbyAirports: ["SNA", "ONT"],
  },
  {
    code: "NYC",
    name: "New York",
    primaryAirports: ["LGA", "JFK"],
    nearbyAirports: ["EWR"],
  },
  {
    code: "LAS",
    name: "Las Vegas",
    primaryAirports: ["LAS"],
    nearbyAirports: [],
  },
  {
    code: "MCO",
    name: "Orlando",
    primaryAirports: ["MCO"],
    nearbyAirports: [],
  },
  {
    code: "SFL",
    name: "South Florida",
    primaryAirports: ["FLL", "MIA"],
    nearbyAirports: [],
  },
] as const;

export const savedRouteSeeds = [
  {
    origin: "LAS",
    destination: "BUR",
    label: "LAS → BUR watch",
    watched: true,
    note: "Personal watch only. A possible discontinuation around October 2026 was mentioned by the user. This note is not a schedule fact, not an announcement, and not confirmation that the route ends.",
  },
  {
    origin: "BUR",
    destination: "LAS",
    label: "BUR → LAS watch",
    watched: true,
    note: "Personal watch only. Direction is stored separately from LAS → BUR. No end date is inferred from the watch.",
  },
];

export const historicalFrequentSeeds = [
  { origin: "OAK", destination: "LAS", label: "Historical frequent: OAK → LAS" },
  { origin: "LAS", destination: "BUR", label: "Historical frequent: LAS → BUR" },
  { origin: "LAS", destination: "LAX", label: "Historical frequent: LAS → LAX" },
  { origin: "LAX", destination: "SFO", label: "Historical frequent: LAX → SFO" },
];

export const sourceSeeds = [
  {
    id: "frontier-newsroom",
    name: "Frontier Newsroom",
    tier: 1,
    kind: "announcement",
    baseUrl: "https://news.flyfrontier.com/",
  },
  {
    id: "frontier-route-pages",
    name: "Frontier flights-from pages",
    tier: 1,
    kind: "frontier_route_page",
    baseUrl: "https://flights.flyfrontier.com/en/sitemap/flights-from-city/page-1",
  },
  {
    id: "frontier-schedule",
    name: "Frontier schedule / timetable API",
    tier: 3,
    kind: "timetable_api",
    baseUrl: null,
  },
  {
    id: "airport-press",
    name: "Airport press releases",
    tier: 2,
    kind: "airport_press",
    baseUrl: null,
  },
  {
    id: "bts-popularity",
    name: "BTS T-100 passengers",
    tier: 4,
    kind: "bts",
    baseUrl: "https://data.transportation.gov/resource/xgub-n9bw.json",
  },
  {
    id: "frontier-programs",
    name: "Frontier GoWild and Discount Den pages",
    tier: 1,
    kind: "program",
    baseUrl: "https://www.flyfrontier.com/deals/gowild-pass",
  },
] as const;
