import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { YardDirectory } from "./YardDirectory";
import type { MapYard } from "./yard-map-data";
import { homeMetadata } from "./home-metadata";

const yards: MapYard[] = Array.from({ length: 382 }, (_, index) => ({
  source: "pyp",
  code: String(index),
  name: `Yard ${index}`,
  city: "City",
  state: "CA",
  lat: 34,
  lng: -118,
  vehicleCount: 100,
  address: "123 Main St",
  phone: "555-123-4567",
  email: "yard@example.com",
  mapsUrl: "https://www.google.com/maps/search/?api=1&query=Yard",
  path: { href: `/junkyards/california/yard-${index}` },
  website: { href: "https://example.com", kind: "yard" },
}));

test("directory renders a bounded window with crawlable inventory links", () => {
  const html = renderToStaticMarkup(
    <YardDirectory yards={yards} selected={null} onSelect={() => {}} />,
  );
  const buttons = html.match(/<button[^>]*>/g) ?? [];
  expect(buttons.length).toBeGreaterThan(0);
  expect(buttons.length).toBeLessThan(15);
  expect(html).toContain('href="/junkyards/california/yard-0"');
  expect(html).toContain('aria-setsize="382"');
  expect(html).toContain('aria-posinset="1"');
  expect(
    buttons.filter((button) => button.includes('tabindex="0"')),
  ).toHaveLength(1);
  const links = html.match(/<a[^>]*>/g) ?? [];
  // Only the active yard's inventory, website, maps, phone, and email join Tab order.
  expect(links.filter((link) => link.includes('tabindex="0"'))).toHaveLength(5);
  expect(
    links.filter((link) => link.includes('tabindex="-1"')).length,
  ).toBeGreaterThan(0);
});

test("an empty directory explains how to recover", () => {
  const html = renderToStaticMarkup(
    <YardDirectory yards={[]} selected={null} onSelect={() => {}} />,
  );
  expect(html).toContain(
    "No matching yards. Try another city or state abbreviation.",
  );
  expect(html).not.toContain("<button");
});

test("homepage metadata uses the live count in search and social previews", () => {
  const metadata = homeMetadata(382);
  expect(metadata.title).toEqual({
    absolute: "Search Junkyard Inventory at 382 Salvage Yards | Junkyard Index",
  });
  expect(metadata.description).toContain("382 salvage yards");
  expect(metadata.openGraph?.title).toBe(
    "Search Junkyard Inventory at 382 Salvage Yards",
  );
  expect(metadata.twitter?.title).toBe(
    "Search Junkyard Inventory at 382 Salvage Yards",
  );
  expect(homeMetadata(1234).description).toContain("1,234 salvage yards");
});
