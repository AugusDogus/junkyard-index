import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DesktopFiltersBar } from "./DesktopFiltersBar";
import { MobileFilterContent } from "./MobileFilterContent";

const emptyFilterOptions = {
  makes: [],
  colors: [],
  states: [],
  salvageYards: [],
};

const noOp = () => undefined;

describe("search filter visibility", () => {
  test("allows entering saved-search filters when inventory has no suggestions", () => {
    const markup = renderToStaticMarkup(
      <MobileFilterContent
        defaultOpenSections="all"
        allowCustomValues
        makes={[]}
        colors={[]}
        states={[]}
        salvageYards={[]}
        sources={[]}
        yearRange={[1900, 2027]}
        filterOptions={emptyFilterOptions}
        onMakesChange={noOp}
        onColorsChange={noOp}
        onStatesChange={noOp}
        onSalvageYardsChange={noOp}
        onSourcesChange={noOp}
        onYearRangeChange={noOp}
        canUseAdvancedFilters
      />,
    );

    for (const label of [
      "Search makes",
      "Search colors",
      "Search states",
      "Search yards",
    ]) {
      expect(markup).toContain(`aria-label="${label}"`);
    }
  });

  test("keeps the desktop make filter visible when the current search has no facet values", () => {
    const markup = renderToStaticMarkup(
      <DesktopFiltersBar
        advancedSearchControl={<button type="button">Advanced search</button>}
        activeFilterCount={1}
        clearAllFilters={noOp}
        makes={[]}
        colors={[]}
        states={[]}
        salvageYards={[]}
        sources={[]}
        yearRange={[2027, 2027]}
        filterOptions={emptyFilterOptions}
        onMakesChange={noOp}
        onColorsChange={noOp}
        onStatesChange={noOp}
        onSalvageYardsChange={noOp}
        onSourcesChange={noOp}
        onYearRangeChange={noOp}
        yearRangeLimits={{ min: 1900, max: 2027 }}
        canUseAdvancedFilters
      />,
    );

    expect(markup).toContain(">Make<");
    expect(markup).toContain(">Advanced search</button>");
  });

  test("shows an advanced search upgrade action without paid filter access", () => {
    const markup = renderToStaticMarkup(
      <DesktopFiltersBar
        advancedSearchControl={
          <button aria-label="Advanced search, upgrade required" type="button">
            Advanced search
          </button>
        }
        activeFilterCount={0}
        clearAllFilters={noOp}
        makes={[]}
        colors={[]}
        states={[]}
        salvageYards={[]}
        sources={[]}
        yearRange={[1900, 2027]}
        filterOptions={emptyFilterOptions}
        onMakesChange={noOp}
        onColorsChange={noOp}
        onStatesChange={noOp}
        onSalvageYardsChange={noOp}
        onSourcesChange={noOp}
        onYearRangeChange={noOp}
        yearRangeLimits={{ min: 1900, max: 2027 }}
        canUseAdvancedFilters={false}
      />,
    );

    expect(markup).toContain("upgrade required");
    expect(markup).toContain("Advanced search");
  });

  test("keeps the mobile make filter visible when the current search has no facet values", () => {
    const markup = renderToStaticMarkup(
      <MobileFilterContent
        makes={[]}
        colors={[]}
        states={[]}
        salvageYards={[]}
        sources={[]}
        yearRange={[2027, 2027]}
        filterOptions={emptyFilterOptions}
        onMakesChange={noOp}
        onColorsChange={noOp}
        onStatesChange={noOp}
        onSalvageYardsChange={noOp}
        onSourcesChange={noOp}
        onYearRangeChange={noOp}
        yearRangeLimits={{ min: 1900, max: 2027 }}
        canUseAdvancedFilters
      />,
    );

    expect(markup).toContain(">Make<");
  });

  test("starts every settings filter section closed", () => {
    const markup = renderToStaticMarkup(
      <MobileFilterContent
        defaultOpenSections="none"
        makes={[]}
        colors={[]}
        states={[]}
        salvageYards={[]}
        sources={[]}
        yearRange={[1900, 2027]}
        filterOptions={{
          ...emptyFilterOptions,
          makes: Array.from({ length: 11 }, (_, index) => `Make ${index}`),
        }}
        onMakesChange={noOp}
        onColorsChange={noOp}
        onStatesChange={noOp}
        onSalvageYardsChange={noOp}
        onSourcesChange={noOp}
        onYearRangeChange={noOp}
        yearRangeLimits={{ min: 1900, max: 2027 }}
        canUseAdvancedFilters
      />,
    );

    expect(markup).toContain(">Make<");
    expect(markup).not.toContain("Search makes");
    expect(markup).not.toContain("Vehicle year range");
  });
});
