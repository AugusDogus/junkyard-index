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
        yearRange={[1900, 2027]}
        sortBy="newest"
        filterOptions={{
          makes: ["Ford", "Honda"],
          colors: ["Blue", "Red"],
          states: ["IA", "NE"],
          salvageYards: ["Lincoln", "Omaha"],
        }}
        yearRangeLimits={{ min: 1900, max: 2027 }}
        canUseAdvancedFilters
        booleanOrSearchReady
        onSearch={setSubmission}
      />
      <output id="submission">{JSON.stringify(submission)}</output>
    </>
  );
}

createRoot(document.body).render(<Fixture />);
