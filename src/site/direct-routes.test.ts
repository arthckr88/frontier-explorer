import { describe, expect, it } from "vitest";
import { classifyScheduleGap, composeCandidateMarkets, composeOfficialCatalogue, parseFlightsFromPage } from "@/site/direct-routes";

const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: {
    pageProps: {
      queryParams: { user_input_origin_airport_code: "DEN" },
      apolloState: {
        data: {
          fare: { originAirportCode: "DEN", destinationAirportCode: "MCO", originCity: "Denver, CO", destinationCity: "Orlando, FL", layovers: null },
          other: { originAirportCode: "DEN", destinationAirportCode: "LAS", originCity: "Denver, CO", destinationCity: "Las Vegas, NV" },
          link: { __typename: "InterlinkRoutes", title: "More flights from Denver, CO", links: [{ name: "Denver, CO - Anchorage", url: "flights-from-denver-to-anchorage" }] },
        },
      },
    },
  },
})}</script>
originAirports\\":[\\"APA\\",\\"DEN\\",\\"BJC\\"] OriginCityName\\":\\"Denver, CO\\"`;

describe("official direct routes", () => {
  it("keeps IATA fare pairs and does not promote popularity links", () => {
    const page = parseFlightsFromPage(html, "https://flights.flyfrontier.com/en/flights-from-denver");
    const catalogue = composeOfficialCatalogue([page], "2026-09-28T00:00:00.000Z");
    expect(page.originCode).toBe("DEN");
    expect(catalogue.routes.map((route) => `${route.origin}-${route.destination}`)).toEqual(["DEN-LAS", "DEN-MCO"]);
    expect(catalogue.routes.every((route) => route.provenance === "frontier_official_direct_route")).toBe(true);
    expect(catalogue.unresolved).toEqual([]);
    const markets = composeCandidateMarkets(
      [{ originSlug: "denver", destinationSlug: "anchorage", sourceUrl: "https://flights.flyfrontier.com/en/flights-from-denver-to-anchorage" }],
      [page],
      catalogue,
    );
    expect(markets).toHaveLength(1);
    expect(markets[0]?.provenance).toBe("frontier_candidate_market");
  });

  it("records a partial fare module and classifies a dated gap", () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: {
        pageProps: {
          queryParams: { user_input_origin_airport_code: "SFO" },
          apolloState: {
            data: {
              module: {
                fares: [{ originAirportCode: "SFO", destinationAirportCode: "LAS", layovers: [] }],
                pagination: { total: 1, lastPage: 1, to: 1 },
              },
            },
          },
        },
      },
    })}</script>`;
    const page = parseFlightsFromPage(html, "https://flights.flyfrontier.com/en/flights-from-san-francisco");
    expect(page.fareModule).toEqual({ embedded: 1, total: 1, lastPage: 1 });
    const gap = classifyScheduleGap("SFO", "LAX", page.fareModule);
    expect(gap.classification).toBe("SCHEDULE_CONFIRMED_ONLY");
    expect(gap.reason).toContain("complete");
    const partial = classifyScheduleGap("LAS", "BUR", { embedded: 20, total: 30 });
    expect(partial.classification).toBe("SCHEDULE_CONFIRMED_ONLY");
    expect(partial.reason).toContain("embedded key");
  });
});
