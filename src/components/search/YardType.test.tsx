import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import { HiddenSourcesProvider } from "~/components/HiddenSourcesContext";
import { HiddenSources } from "~/lib/hidden-source";
import { SavedSearchCriteria } from "./SavedSearchCriteria";
import { VehicleCard } from "./VehicleCard";
import { YardTypeFilter } from "./FilterFields";
import { algoliaHitToSearchVehicle } from "~/lib/search-vehicles";
import type { DataSource } from "~/lib/types";

// Cards read the hidden sources from the page; none are hidden here.
function renderToStaticMarkup(node: ReactNode): string {
  return renderMarkup(
    <HiddenSourcesProvider hidden={HiddenSources.none}>
      {node}
    </HiddenSourcesProvider>,
  );
}

test.each([
  { source: "pyp", label: "Self-service", hint: false },
  { source: "importapart", label: "Full-service", hint: true },
  { source: "ipullupull", label: "Self &amp; full service", hint: false },
  { source: "row52", label: null, hint: false },
] satisfies { source: DataSource; label: string | null; hint: boolean }[])(
  "vehicle card shows the service row for $source",
  ({ source, label, hint }) => {
    const vehicle = algoliaHitToSearchVehicle({
      objectID: "test",
      vin: "1FADP3F29FL123456",
      source,
      locationCode: "unreviewed",
      locationName: "Test Yard",
    });
    if (!vehicle) throw new Error("Expected a supported test source");
    const html = renderToStaticMarkup(<VehicleCard vehicle={vehicle} />);
    if (label) expect(html).toContain(`Yard type: ${label}`);
    else expect(html).not.toContain("Yard type:");
    expect(html.includes("Parts may already be pulled. Call the yard.")).toBe(
      hint,
    );
  },
);

test("yard type controls start with neither option selected", () => {
  const html = renderToStaticMarkup(
    <YardTypeFilter
      idPrefix="test"
      yardTypes={[]}
      onYardTypesChange={() => undefined}
    />,
  );
  expect(html).toContain("Self-service");
  expect(html).toContain("Full-service");
  expect(html).not.toContain('data-state="checked"');
});

test("directory copy describes the mixed inventory accurately", () => {
  const page = readFileSync(
    new URL("../../app/junkyards/page.tsx", import.meta.url),
    "utf8",
  );
  expect(page).toContain("salvage yards in");
  expect(page).not.toContain("self-service yards in");
  expect(page).toContain("Self-service and full-service salvage yards");
  const readme = readFileSync(
    new URL("../../../README.md", import.meta.url),
    "utf8",
  );
  expect(readme).toContain("self-service and full-service salvage yards");
});

test("saved criteria show a yard-type-only search accurately", () => {
  const html = renderToStaticMarkup(
    <SavedSearchCriteria query="" filters={{ yardTypes: ["full_service"] }} />,
  );
  expect(html).toContain("Yard type");
  expect(html).toContain("Full-service");
  expect(html).not.toContain("All vehicles");
});
