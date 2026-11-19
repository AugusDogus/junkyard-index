import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { algoliaHitToSearchVehicle } from "~/lib/search-vehicles";
import { SearchResults } from "./SearchResults";

test("loading results reserve a responsive card grid", () => {
  const html = renderToStaticMarkup(
    <SearchResults
      searchResult={{
        vehicles: [],
        totalCount: 0,
        page: 1,
        hasMore: false,
        searchTime: 0,
        locationsCovered: 0,
        locationsWithErrors: [],
      }}
      isLoading={true}
    />,
  );
  expect(html).toContain("grid-cols-1");
  expect(html).toContain("md:grid-cols-2");
  expect(html).toContain("lg:grid-cols-3");
  expect(html).not.toContain("grid-template-columns");
  expect(html).toContain('data-slot="skeleton"');
});

test("loaded first cards render on the server without waiting for viewport measurement", () => {
  const vehicle = algoliaHitToSearchVehicle({
    source: "pyp",
    objectID: "civic",
    year: 2012,
    make: "Honda",
    model: "Civic",
  });
  if (!vehicle) throw new Error("Expected a supported test source");
  const html = renderToStaticMarkup(
    <SearchResults
      searchResult={{
        vehicles: [vehicle],
        totalCount: 1,
        page: 1,
        hasMore: false,
        searchTime: 0,
        locationsCovered: 0,
        locationsWithErrors: [],
      }}
      isLoading={false}
    />,
  );
  expect(html).toContain("Honda");
  expect(html).toContain("Civic");
  expect(html).not.toContain('data-slot="skeleton"');
});
