import { describe, expect, test } from "bun:test";
import {
  YardService,
  type YardService as Service,
  type YardType,
} from "./yard-service";
import { compileAlertFilters } from "./algolia-alert-search";
import { compileSearchExpression } from "./compile-search-expression";
import { SearchCriteria } from "./search-criteria";
import {
  expressionFromCriteria,
  criteriaFromExpression,
} from "./search-expression-criteria";
import { parseExpression } from "./search-expression";
import {
  savedSearchDraft,
  serializeSavedSearchDraft,
} from "./saved-search-draft";
import {
  filtersSchema,
  savedSearchMatchCriteriaKey,
} from "./saved-search-filters";
import { buildSearchUrl } from "./search-utils";
import { SearchUrlTestFixtures } from "~/components/search/search-url-test-fixtures";
import { COMMON_ALGOLIA_INDEX_SETTINGS } from "~/server/ingestion/algolia-settings-plan";

const services: Service[] = [
  { kind: "self_service" },
  { kind: "full_service" },
  { kind: "both" },
  { kind: "unknown", reason: "Unreviewed" },
];

describe("yard type filters", () => {
  test.each([
    {
      selected: [],
      expected: ["self_service", "full_service", "both", "unknown"],
    },
    { selected: ["self_service"], expected: ["self_service", "both"] },
    { selected: ["full_service"], expected: ["full_service", "both"] },
    {
      selected: ["self_service", "full_service"],
      expected: ["self_service", "full_service", "both"],
    },
  ] satisfies { selected: YardType[]; expected: Service["kind"][] }[])(
    "matches $selected including both, excluding unknown only when filtered",
    ({ selected, expected }) => {
      const matched = services.filter(
        (service) =>
          !selected.length ||
          selected.some((type) => YardService.types(service).includes(type)),
      );
      expect(matched.map((service) => service.kind)).toEqual(expected);
      expect(COMMON_ALGOLIA_INDEX_SETTINGS.attributesForFaceting).toContain(
        "yardTypes",
      );
      const compilation = compileAlertFilters({ yardTypes: selected }, null);
      expect(compilation).toEqual({
        kind: "filter",
        value:
          selected.length === 2
            ? '(yardTypes:"self_service" OR yardTypes:"full_service")'
            : selected.length === 1
              ? `yardTypes:"${selected[0]}"`
              : undefined,
      });
    },
  );

  test("round-trips saved filters, alert criteria, and search URLs", () => {
    const filters = filtersSchema.parse({
      yardTypes: ["self_service", "full_service"],
    });
    const criteria = SearchCriteria.fromSavedSearch("Volvo", filters);
    const saved = SearchCriteria.toSavedSearch(criteria);
    expect(saved.success && saved.data.filters.yardTypes).toEqual(
      filters.yardTypes,
    );
    expect(savedSearchMatchCriteriaKey("Volvo", filters)).not.toBe(
      savedSearchMatchCriteriaKey("Volvo", {}),
    );
    expect(savedSearchMatchCriteriaKey("Volvo", filters)).toBe(
      savedSearchMatchCriteriaKey("Volvo", {
        yardTypes: ["full_service", "self_service"],
      }),
    );
    const url = buildSearchUrl("Volvo", filters);
    const href = `https://example.com${url}`;
    expect(SearchUrlTestFixtures.read(href).refinementList).toEqual({
      yardTypes: ["self_service", "full_service"],
    });
    expect(SearchUrlTestFixtures.write(href)).toBe(href);
    expect(filtersSchema.safeParse({ yardTypes: ["both"] }).success).toBe(
      false,
    );
    expect(filtersSchema.safeParse({ yardTypes: ["unknown"] }).success).toBe(
      false,
    );
  });

  test("drops unsupported URL types and clears selected types", () => {
    const href =
      "https://example.com/search?yardTypes=both,unknown,self_service";
    expect(SearchUrlTestFixtures.read(href).refinementList).toEqual({
      yardTypes: ["self_service"],
    });
    expect(
      SearchUrlTestFixtures.write(href, undefined, {
        sortBy: "vehicles_newest",
        refinementList: { yardTypes: [] },
      }),
    ).toBe("https://example.com/search?yardTypes%5B%5D=all");
  });

  test("preserves yard type through advanced expression and saved-search editing", () => {
    const criteria = SearchCriteria.fromSavedSearch("Volvo", {
      yardTypes: ["self_service"],
    });
    const expression = expressionFromCriteria(criteria);
    const parsed = parseExpression(expression);
    expect(
      parsed.success && criteriaFromExpression(parsed.value, criteria),
    ).toEqual(criteria);
    expect(compileSearchExpression(expression)).toEqual({
      success: true,
      data: {
        query: "Volvo",
        filters: 'yardTypes:"self_service"',
        requiresTokens: false,
        hasFields: true,
      },
    });
    expect(compileSearchExpression("yardType:unknown").success).toBe(false);
    expect(compileSearchExpression("!yardType:self_service").success).toBe(
      false,
    );
    const original = {
      id: "test",
      name: "Volvo",
      query: "",
      filters: {
        expression: "make:Volvo",
        yardTypes: ["full_service"] satisfies YardType[],
      },
      emailAlertsEnabled: true,
      discordAlertsEnabled: false,
    };
    const draft = savedSearchDraft(original);
    expect(draft.expression).toContain("yardType:full_service");
    const serialized = serializeSavedSearchDraft({
      ...draft,
      expression: `${draft.expression} AND year:2000`,
    });
    expect(serialized.success && serialized.data.filters.expression).toContain(
      "yardType:full_service",
    );
  });
});
