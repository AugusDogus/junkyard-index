import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AdvancedSearchDialog } from "~/components/search/AdvancedSearchDialog";
import { MobileFiltersDrawer } from "~/components/search/MobileFiltersDrawer";

function Fixture() {
  const [open, setOpen] = useState(false);
  const filters = {
    makes: [],
    colors: [],
    states: [],
    salvageYards: [],
    sources: [],
    yardTypes: [],
    yearRange: [1900, 2027] satisfies [number, number],
    filterOptions: { makes: [], colors: [], states: [], salvageYards: [] },
    canUseAdvancedFilters: false,
  };
  return (
    <>
      <button type="button">Background before</button>
      <MobileFiltersDrawer
        {...filters}
        activeFilterCount={0}
        onAdvancedSearch={() => setOpen(true)}
        clearAllFilters={() => {}}
        onMakesChange={() => {}}
        onColorsChange={() => {}}
        onStatesChange={() => {}}
        onSalvageYardsChange={() => {}}
        onSourcesChange={() => {}}
        onYardTypesChange={() => {}}
        onYearRangeChange={() => {}}
      />
      <AdvancedSearchDialog
        {...filters}
        query=""
        sortBy="newest"
        booleanOrSearchReady
        open={open}
        onOpenChange={setOpen}
        showTrigger={false}
        onSearch={() => {}}
      />
      <button type="button">Background after</button>
    </>
  );
}
createRoot(document.body).render(<Fixture />);
