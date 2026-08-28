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
  test("keeps the desktop make filter visible when the current search has no facet values", () => {
    const markup = renderToStaticMarkup(
      <DesktopFiltersBar
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
