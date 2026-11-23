import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HiddenSourcesProvider } from "~/components/HiddenSourcesContext";
import { DesktopFiltersBar } from "./DesktopFiltersBar";
import { MobileFilterContent } from "./MobileFilterContent";
import { availableSources, InventorySourcesFilter } from "./FilterFields";
import { HiddenSources } from "~/lib/hidden-source";
import { INGESTION_SOURCES } from "~/lib/ingestion-source";

const HIDDEN = HiddenSources.of(["meeks"]);

function render(node: ReactNode, hidden: HiddenSources = HIDDEN): string {
  return renderToStaticMarkup(
    <HiddenSourcesProvider hidden={hidden}>{node}</HiddenSourcesProvider>,
  );
}

const emptyFilterOptions = {
  makes: [],
  colors: [],
  states: [],
  salvageYards: [],
};

const noOp = () => undefined;

describe("search filter visibility", () => {
  test("offers every registered source but hidden ones, including when selecting all except one", () => {
    const markup = render(
      <InventorySourcesFilter
        idPrefix="test"
        sources={[]}
        onSourcesChange={noOp}
      />,
    );
    for (const source of INGESTION_SOURCES) {
      expect(markup.includes(`id="test-${source}"`)).toBe(
        !HiddenSources.has(HIDDEN, source),
      );
    }
    const available = availableSources(HIDDEN);
    expect(available.filter((source) => source !== "row52")).toContain(
      "pullnsave",
    );
    expect(available.filter((source) => source !== "row52")).toContain(
      "tearapart",
    );
  });

  test("offers a source again once the server's list no longer hides it", () => {
    const markup = render(
      <InventorySourcesFilter
        idPrefix="test"
        sources={[]}
        onSourcesChange={noOp}
      />,
      HiddenSources.none,
    );
    expect(markup).toContain('id="test-meeks"');
  });
  test("allows entering saved-search filters when inventory has no suggestions", () => {
    const markup = render(
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
    const markup = render(
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
    const markup = render(
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

    expect(markup).toContain(">Year<");
    expect(markup).not.toContain(">State<");
    expect(markup).toContain("upgrade required");
    expect(markup).toContain("Advanced search");
  });

  for (const canUseAdvancedFilters of [false, true])
    test(`keeps mobile year filtering free and gates make filtering: paid=${canUseAdvancedFilters}`, () => {
      const markup = render(
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
          canUseAdvancedFilters={canUseAdvancedFilters}
        />,
      );

      expect(markup).toContain(">Year<");
      expect(markup).toContain("Vehicle year range");
      expect(markup.includes(">Make<")).toBe(canUseAdvancedFilters);
    });

  test("starts every settings filter section closed", () => {
    const markup = render(
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
