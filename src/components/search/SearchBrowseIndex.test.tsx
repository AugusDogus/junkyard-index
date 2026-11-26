import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Region } from "~/lib/region";
import { SearchBrowseIndex } from "./SearchBrowseIndex";

test("browse links point at followable state and make pages", () => {
  const regions = [Region.fromAbbr("CA"), Region.fromAbbr("TX")].filter(
    (region) => region !== null,
  );
  const html = renderToStaticMarkup(
    <SearchBrowseIndex
      regions={regions}
      makes={[{ name: "Toyota", href: "/cars/toyota" }]}
    />,
  );
  expect(html).toContain("Browse salvage yard inventory");
  expect(html).toContain('href="/junkyards/california"');
  expect(html).toContain('href="/junkyards/texas"');
  expect(html).toContain('href="/cars/toyota"');
  expect(html).not.toContain("nofollow");
});
