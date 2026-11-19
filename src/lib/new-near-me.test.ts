import { expect, test } from "bun:test";
import { SearchCriteria } from "./search-criteria";
import { SearchArea } from "./search-area";
import { buildSearchUrl } from "./search-utils";
import {
  savedSearchDraft,
  serializeSavedSearchDraft,
} from "./saved-search-draft";
import {
  filtersSchema,
  savedSearchMatchCriteriaKey,
} from "./saved-search-filters";

const filters = () =>
  filtersSchema.parse({
    arrivalWindow: "7d",
    near: { lat: 33.448, lng: -112.074, radiusMiles: 50 },
    salvageYards: ["RTP Pick-A-Part - Hebron, KY"],
    yardTypes: ["self_service"],
  });

test("nearby URLs reject blank coordinates instead of searching from zero", () => {
  expect(
    SearchArea.fromUrl(new URLSearchParams("lat=&lng=&radius=50")),
  ).toBeUndefined();
  expect(
    SearchArea.fromUrl(
      new URLSearchParams("lat=33.448&lng=-112.074&radius=50"),
    ),
  ).toEqual(filters().near);
});

test("saving and editing preserve the relative arrival window and fixed search area", () => {
  const value = filters();
  expect(value).toHaveProperty("arrivalWindow", "7d");
  const criteria = SearchCriteria.fromSavedSearch("Honda", value);
  expect(SearchCriteria.toSavedSearch(criteria)).toMatchObject({
    success: true,
    data: { filters: value },
  });
  const search = {
    id: "new",
    name: "Arrivals",
    query: "",
    filters: { ...value, expression: "make:Honda" },
    emailAlertsEnabled: true,
    discordAlertsEnabled: false,
  };
  const draft = savedSearchDraft(search);
  draft.expression = "make:Toyota";
  expect(serializeSavedSearchDraft(draft)).toMatchObject({
    success: true,
    data: {
      filters: {
        arrivalWindow: "7d",
        near: value.near,
        expression: "make:Toyota",
      },
    },
  });
});

test("saved search URLs keep window, comma yard, and area", () => {
  const params = new URL(buildSearchUrl("", filters()), "https://example.com")
    .searchParams;
  expect(params.getAll("arrivalWindow[]")).toEqual(["7d"]);
  expect(params.getAll("yards[]")).toEqual(["RTP Pick-A-Part - Hebron, KY"]);
  expect(params.get("lat")).toBe("33.448");
  expect(params.get("lng")).toBe("-112.074");
  expect(params.get("radius")).toBe("50");
});

test("arrival and area changes reset alert matching, sort changes do not", () => {
  expect(savedSearchMatchCriteriaKey("", filters())).not.toBe(
    savedSearchMatchCriteriaKey("", {}),
  );
  expect(savedSearchMatchCriteriaKey("", filters())).toBe(
    savedSearchMatchCriteriaKey("", { ...filters(), sortBy: "distance" }),
  );
  expect(filtersSchema.safeParse({ arrivalWindow: "forever" }).success).toBe(
    false,
  );
  expect(
    filtersSchema.safeParse({ near: { lat: 91, lng: 0, radiusMiles: 50 } })
      .success,
  ).toBe(false);
});
