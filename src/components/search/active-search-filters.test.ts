import { describe, expect, test } from "bun:test";
import {
  ActiveSearchFilter,
  type ActiveSearchFilterInput,
} from "./active-search-filters";

const none: ActiveSearchFilterInput = {
  arrivalWindow: undefined,
  radiusMiles: null,
  origin: { kind: "approximate" },
  yardTypes: ["self_service"],
  defaultYardTypes: ["self_service"],
  yearRange: [1900, 2027],
  yearLimits: { min: 1900, max: 2027 },
  makes: [],
  colors: [],
  states: [],
  salvageYards: [],
  sources: [],
};

const labels = (input: Partial<ActiveSearchFilterInput>) =>
  ActiveSearchFilter.list({ ...none, ...input }).map(ActiveSearchFilter.label);

describe("active search filters", () => {
  test("the default search has no active filters", () => {
    expect(ActiveSearchFilter.list(none)).toEqual([]);
  });

  test("the self-service default is not a filter, other yard scopes are", () => {
    expect(labels({ yardTypes: ["self_service", "full_service"] })).toEqual([
      "Full-service included",
    ]);
    expect(labels({ yardTypes: ["full_service"] })).toEqual([
      "Full-service only",
    ]);
    expect(labels({ yardTypes: [] })).toEqual(["All yards"]);
  });

  test("an expression that owns yard types makes no yard facet the default", () => {
    expect(labels({ yardTypes: [], defaultYardTypes: [] })).toEqual([]);
    expect(
      labels({ yardTypes: ["self_service"], defaultYardTypes: [] }),
    ).toEqual(["Self-service only"]);
  });

  test("arrival and distance read as the shopper would say them", () => {
    expect(labels({ arrivalWindow: "7d" })).toEqual(["Last 7 days"]);
    expect(
      labels({
        radiusMiles: 50,
        origin: { kind: "zip", zipCode: "32571" },
      }),
    ).toEqual(["Within 50 mi of 32571"]);
    expect(
      labels({ radiusMiles: 25, origin: { kind: "savedSearch" } }),
    ).toEqual(["Within 25 mi of saved location"]);
    expect(labels({ radiusMiles: 100 })).toEqual(["Within 100 mi"]);
  });

  test("years and lists summarize without growing past a short chip", () => {
    expect(labels({ yearRange: [2000, 2010] })).toEqual(["2000 to 2010"]);
    expect(labels({ yearRange: [2008, 2008] })).toEqual(["2008"]);
    expect(labels({ makes: ["Honda"] })).toEqual(["Honda"]);
    expect(labels({ makes: ["Honda", "Toyota"] })).toEqual(["Honda, Toyota"]);
    expect(labels({ states: ["Alabama", "Ohio", "Utah"] })).toEqual([
      "3 states",
    ]);
    expect(labels({ sources: ["pyp", "rtp"] })).toEqual(["2 sources"]);
  });

  test("lists filters in a stable order, one per kind", () => {
    expect(
      ActiveSearchFilter.list({
        ...none,
        sources: ["pyp"],
        makes: ["Honda"],
        arrivalWindow: "24h",
        yardTypes: [],
        radiusMiles: 50,
      }).map((filter) => filter.kind),
    ).toEqual(["arrival", "distance", "yardTypes", "makes", "sources"]);
  });
});
