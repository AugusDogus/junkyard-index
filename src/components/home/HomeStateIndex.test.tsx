import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Region } from "~/lib/region";
import { HomeStateIndex } from "./HomeStateIndex";

function region(abbr: string): Region {
  const found = Region.fromAbbr(abbr);
  if (!found) throw new Error(`Test region ${abbr} is not a known region.`);
  return found;
}

// The homepage is the page search engines crawl most. Its yard directory is
// virtualized, so only a few yard rows reach server HTML; these plain links
// are how crawlers reach every state hub and, through them, every yard.
test("links every state hub, the directory, and the chains hub as plain anchors", () => {
  const html = renderToStaticMarkup(
    <HomeStateIndex
      regions={[
        { region: region("KY"), yards: 3 },
        { region: region("AB"), yards: 1 },
      ]}
      chains={[]}
    />,
  );
  expect(html).toContain('href="/junkyards/kentucky"');
  expect(html).toContain("Kentucky");
  expect(html).toContain('href="/junkyards/alberta"');
  expect(html).toContain('href="/junkyards"');
  expect(html).toContain('href="/chains"');
  expect(html).not.toContain("nofollow");
});

test("links each chain hub by name with its yard count", () => {
  const html = renderToStaticMarkup(
    <HomeStateIndex
      regions={[{ region: region("KY"), yards: 3 }]}
      chains={[
        {
          name: "LKQ Pick Your Part",
          href: "/chains/lkq-pick-your-part",
          yards: 60,
        },
        { name: "Pick-n-Pull", href: "/chains/pick-n-pull", yards: 50 },
      ]}
    />,
  );
  expect(html).toContain('href="/chains/lkq-pick-your-part"');
  expect(html).toContain("LKQ Pick Your Part inventory");
  expect(html).toContain("60 yards");
  expect(html).toContain('href="/chains/pick-n-pull"');
  expect(html).not.toContain("nofollow");
});
