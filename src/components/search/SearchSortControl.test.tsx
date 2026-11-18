import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchSortControl } from "./SearchSortControl";

test("every sort exposes a compact selected label and direction in its accessible name", () => {
  for (const [value, compact, full] of [
    ["newest", "Newest", "Newest First"],
    ["oldest", "Oldest", "Oldest First"],
    ["year-desc", "Year ↓", "Year (High to Low)"],
    ["year-asc", "Year ↑", "Year (Low to High)"],
    ["distance", "Nearest", "Distance (Nearest)"],
    ["relevance", "Relevance", "Relevance"],
  ]) {
    if (!value || !compact || !full) throw new Error("Missing sort fixture");
    const html = renderToStaticMarkup(
      <SearchSortControl value={value} onChange={() => {}} />,
    );
    expect(html).toContain(`aria-label="Sort vehicles: ${compact} (${full})"`);
    expect(html).toContain(`class="md:hidden">${compact}</span>`);
    expect(html).toContain(`class="hidden md:inline">${full}</span>`);
  }
});
