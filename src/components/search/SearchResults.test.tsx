import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchResults } from "./SearchResults";

test("first render uses responsive skeletons until virtual rows can be measured", () => {
  for (const isLoading of [false, true]) {
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
        isLoading={isLoading}
      />,
    );
    expect(html).toContain("grid-cols-1");
    expect(html).toContain("md:grid-cols-2");
    expect(html).toContain("lg:grid-cols-3");
    expect(html).not.toContain("grid-template-columns");
    expect(html).toContain('data-slot="skeleton"');
  }
});
