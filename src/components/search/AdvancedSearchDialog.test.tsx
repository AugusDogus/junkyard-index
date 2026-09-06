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

  test("can render a controlled modal without nesting its trigger", () => {
    const markup = renderToStaticMarkup(
      <AdvancedSearchDialog
        {...baseProps}
        canUseAdvancedFilters
        open={false}
        onOpenChange={noOp}
        showTrigger={false}
      />,
    );

    expect(markup).not.toContain(">Advanced search</button>");
  });

  test("renders an upgrade explanation trigger for free users", () => {
    const markup = renderToStaticMarkup(
      <AdvancedSearchDialog {...baseProps} canUseAdvancedFilters={false} />,
    );

    expect(markup).toContain('aria-label="Advanced search, upgrade required"');
    expect(markup).toContain(">Advanced search</button>");
    expect(markup).toContain("lucide-lock-keyhole");
    expect(markup).not.toContain("Lite");
  });
});

function noOp() {}
