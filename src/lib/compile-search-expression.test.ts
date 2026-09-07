import { describe, test, expect } from "bun:test";
import { compileSearchExpression } from "./compile-search-expression";
import { SearchCriteria } from "./search-criteria";
import { expressionFromCriteria } from "./search-expression-criteria";
import { buildSearchUrl } from "./search-utils";
import {
  savedSearchDraft,
  serializeSavedSearchDraft,
} from "./saved-search-draft";
import { savedSearchMatchCriteriaKey } from "./saved-search-filters";

describe("expression execution", () => {
  test("keeps globally required keywords and phrases in normal text matching", () => {
    expect(
      compileSearchExpression(
        'pickup "crew cab" !diesel (make:Volvo OR make:Saab) year:<2000',
      ),
    ).toEqual({
      success: true,
      data: {
        query: 'pickup "crew cab" -diesel',
        filters: '(make:"Volvo" OR make:"Saab") AND year < 2000',
        requiresTokens: false,
        hasFields: true,
      },
    });
  });
  test("distributes cross-field facet groups without flattening their meaning", () => {
    const result = compileSearchExpression(
      "(make:Volvo state:Texas) OR (make:Saab state:Iowa)",
    );
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data.filters).toBe(
        '(make:"Volvo" OR make:"Saab") AND (make:"Volvo" OR state:"Iowa") AND (state:"Texas" OR make:"Saab") AND (state:"Texas" OR state:"Iowa")',
      );
  });
  test("rejects unsupported or explosive queries instead of weakening them", () => {
    for (const text of [
      "make:Volvo OR year:<2000",
      Array.from({ length: 9 }, () => "(make:Volvo state:Texas)").join(" OR "),
      "(".repeat(14) + "Volvo" + ")".repeat(14),
    ])
      expect(compileSearchExpression(text).success).toBe(false);
  });
  test("preserves legacy OR precedence and literal field-looking words", () => {
    const result = compileSearchExpression(
      expressionFromCriteria(
        SearchCriteria.fromSavedSearch("Volvo OR Saab diesel make:Ford", {}),
      ),
    );
    expect(result).toEqual({
      success: true,
      data: {
        query: 'diesel "make:Ford"',
        filters: '(searchTokens:"volvo" OR searchTokens:"saab")',
        requiresTokens: true,
        hasFields: false,
      },
    });
  });
  test("new expression changes alert identity and URLs retain the format", () => {
    expect(
      savedSearchMatchCriteriaKey("", { expression: "make:Volvo" }),
    ).not.toBe(savedSearchMatchCriteriaKey("", { expression: "make:Saab" }));
    const url = new URL(
      buildSearchUrl("", {
        expression: "make:Volvo year:<2000",
        sortBy: "oldest",
      }),
      "https://example.com",
    );
    expect(url.searchParams.get("syntax")).toBe("expression");
    expect(url.searchParams.get("q")).toBe("make:Volvo year:<2000");
    expect(url.searchParams.get("sort")).toBe("oldest");
  });
  test("rename, sort, alert and mode-only edits keep legacy matching payload", () => {
    const search = {
      id: "test",
      name: "Volvo",
      query: "Volvo OR Saab diesel",
      filters: {
        makes: ["Volvo"],
        minYear: 1963,
        maxYear: 2000,
        sortBy: "newest",
      },
      emailAlertsEnabled: true,
      discordAlertsEnabled: false,
    };
    const draft = savedSearchDraft(search);
    draft.name = "Renamed";
    draft.email = false;
    draft.criteria.sortBy = "oldest";
    draft.expression = expressionFromCriteria(draft.criteria);
    const result = serializeSavedSearchDraft(draft, search);
    expect(result).toEqual({
      success: true,
      data: {
        query: search.query,
        filters: { ...search.filters, sortBy: "oldest" },
      },
    });
  });
  test("expression editing incorporates additional GUI filters and removes stale flat fields on save", () => {
    const search = {
      id: "test",
      name: "Volvo",
      query: "",
      filters: { expression: "make:Volvo", states: ["Texas"] },
      emailAlertsEnabled: false,
      discordAlertsEnabled: false,
    };
    const draft = savedSearchDraft(search);
    expect(draft.expression).toBe("(make:Volvo) AND state:Texas");
    draft.expression += " AND year:<2000";
    expect(serializeSavedSearchDraft(draft, search)).toEqual({
      success: true,
      data: {
        query: "",
        filters: {
          expression: "(make:Volvo) AND state:Texas AND year:<2000",
          sortBy: "newest",
        },
      },
    });
  });
});

test("legacy quoted alternatives still match full indexed values", () => {
  const expression = expressionFromCriteria(
    SearchCriteria.fromSavedSearch('"Ford Mustang" OR "Chevrolet Camaro"', {}),
  );
  expect(compileSearchExpression(expression)).toMatchObject({
    success: true,
    data: {
      query: "",
      filters:
        '(searchTokens:"ford mustang" OR searchTokens:"chevrolet camaro")',
    },
  });
});

test("legacy literal backslashes and inner quotes survive expression migration", () => {
  for (const query of ['"C:\\Volvo"', '"Augie\\"s Volvo"']) {
    const expression = expressionFromCriteria(
      SearchCriteria.fromSavedSearch(query, {}),
    );
    expect(compileSearchExpression(expression).success).toBe(true);
  }
});

test("builder normalization does not reset alert identity", () => {
  const search = {
    id: "test",
    name: "Volvo",
    query: "",
    filters: { expression: "make:Volvo year:<2000" },
    emailAlertsEnabled: true,
    discordAlertsEnabled: false,
  };
  const draft = savedSearchDraft(search);
  draft.expression = "make:Volvo AND year:<2000";
  expect(serializeSavedSearchDraft(draft, search)).toEqual({
    success: true,
    data: { query: "", filters: { ...search.filters, sortBy: "newest" } },
  });
  expect(savedSearchMatchCriteriaKey("", search.filters)).toBe(
    savedSearchMatchCriteriaKey("", { expression: draft.expression }),
  );
});

test("legacy ranges below the inventory slider survive a criteria edit", () => {
  const search = {
    id: "test",
    name: "Old",
    query: "Volvo",
    filters: { minYear: 1886, maxYear: 2000 },
    emailAlertsEnabled: false,
    discordAlertsEnabled: false,
  };
  const draft = savedSearchDraft(search);
  expect(draft.criteria.yearRange).toEqual([1886, 2000]);
  expect(expressionFromCriteria(draft.criteria)).toContain("year:>=1886");
});

test("inverted legacy year ranges retain their existing matching semantics", () => {
  const draft = savedSearchDraft({
    id: "test",
    name: "Old",
    query: "Volvo",
    filters: { minYear: 2000, maxYear: 1963 },
    emailAlertsEnabled: false,
    discordAlertsEnabled: false,
  });
  expect(draft.criteria.yearRange).toEqual([1963, 2000]);
  expect(expressionFromCriteria(draft.criteria)).toBe(
    "Volvo AND year:>=1963 AND year:<=2000",
  );
});

test("a VIN-looking expression remains an advanced text search", () => {
  const draft = savedSearchDraft({
    id: "test",
    name: "Text",
    query: "1HGCM82633A004352",
    filters: { expression: "1HGCM82633A004352" },
    emailAlertsEnabled: false,
    discordAlertsEnabled: false,
  });
  expect(draft.criteria.queryMode).toBe("keywords");
  expect(draft.expression).toBe("1HGCM82633A004352");
});
