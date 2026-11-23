import { HiddenSourcesProvider } from "~/components/HiddenSourcesContext";
import { HiddenSources } from "~/lib/hidden-source";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AdvancedSearchDialog,
  type AdvancedSearchSubmission,
} from "~/components/search/AdvancedSearchDialog";

function Fixture() {
  const [submission, setSubmission] = useState<AdvancedSearchSubmission | null>(
    null,
  );
  return (
    <>
      <AdvancedSearchDialog
        query="no-matching-vehicle"
        makes={["Saab"]}
        colors={[]}
        states={[]}
        salvageYards={[]}
        sources={[]}
        yardTypes={[]}
        yearRange={[1900, 2027]}
        sortBy="newest"
        filterOptions={{
          makes: ["Ford", "Honda"],
          colors: ["Blue", "Red"],
          states: ["IA", "NE"],
          salvageYards: ["Lincoln", "Omaha"],
        }}
        canUseAdvancedFilters
        booleanOrSearchReady
        onSearch={setSubmission}
      />
      <output id="submission">{JSON.stringify(submission)}</output>
    </>
  );
}

createRoot(document.body).render(
  <HiddenSourcesProvider hidden={HiddenSources.none}>
    <Fixture />
  </HiddenSourcesProvider>,
);
