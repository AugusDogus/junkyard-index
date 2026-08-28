import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AdvancedSearchDialog } from "./AdvancedSearchDialog";

const baseProps = {
  query: "",
  makes: [],
  colors: [],
  states: [],
  salvageYards: [],
  sources: [],
  yearRange: [1900, 2027] as [number, number],
  sortBy: "newest",
  filterOptions: {
    makes: [],
    colors: [],
    states: [],
    salvageYards: [],
  },
  yearRangeLimits: { min: 1900, max: 2027 },
  booleanOrSearchReady: true,
  onSearch: () => undefined,
};

describe("advanced search access", () => {
  test("renders a modal trigger for paid users", () => {
    const markup = renderToStaticMarkup(
      <AdvancedSearchDialog {...baseProps} canUseAdvancedFilters />,
    );

    expect(markup).toContain(">Advanced search</button>");
    expect(markup).not.toContain("href=");
  });

  test("renders only disabled text for free users", () => {
    const markup = renderToStaticMarkup(
      <AdvancedSearchDialog {...baseProps} canUseAdvancedFilters={false} />,
    );

    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain(">Advanced search</span>");
    expect(markup).not.toContain("Lite");
  });
});
