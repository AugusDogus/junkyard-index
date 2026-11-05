import { describe, expect, test } from "bun:test";
import { StructuredData } from "./structured-data";
import { YardInventory } from "./yard-inventory";

const origin = "https://junkyardindex.com";
const yard = {
  name: "Pick Your Part - Sun Valley",
  operator: "LKQ Pick Your Part",
  address: "11201 Pendleton St",
  city: "Sun Valley",
  state: "CA",
  postalCode: null,
  country: "US" as const,
  lat: 34.2,
  lng: -118.4,
  phone: "800-962-2277",
  website: {
    kind: "provider" as const,
    href: "https://www.pyp.com/locations/",
  },
};

describe("StructuredData", () => {
  test("serialize keeps stored text from closing the script element", () => {
    const json = StructuredData.serialize({ name: "</script><script>x" });
    expect(json).not.toContain("</script>");
    expect(JSON.parse(json)).toEqual({ name: "</script><script>x" });
  });

  test("breadcrumbs use absolute URLs in order", () => {
    expect(
      StructuredData.breadcrumbs(origin, [
        { name: "Junkyards", href: "/junkyards" },
        { name: "California", href: "/junkyards/california" },
      ]),
    ).toMatchObject({
      itemListElement: [
        { position: 1, item: "https://junkyardindex.com/junkyards" },
        { position: 2, item: "https://junkyardindex.com/junkyards/california" },
      ],
    });
  });

  test("a yard links its own site only when it is yard-specific", () => {
    const href = "/junkyards/california/pick-your-part-sun-valley";
    const provider = StructuredData.yard(origin, href, yard);
    expect(provider).not.toHaveProperty("url");
    expect(provider).toMatchObject({
      "@type": "AutoPartsStore",
      mainEntityOfPage: `${origin}${href}`,
      parentOrganization: { name: "LKQ Pick Your Part" },
      address: { streetAddress: "11201 Pendleton St", addressCountry: "US" },
    });
    expect(provider.address).not.toHaveProperty("postalCode");

    const own = StructuredData.yard(origin, href, {
      ...yard,
      website: { kind: "yard", href: "https://example.com/" },
    });
    expect(own).toMatchObject({ url: "https://example.com/" });
  });

  test("vehicle lists number items from the page's first index", () => {
    const vehicle = YardInventory.vehicle({
      vin: "1HGCM82633A004352",
      year: 2003,
      make: "HONDA",
      model: "ACCORD",
      trim: "EX",
      engine: null,
      color: null,
      stockNumber: null,
      section: null,
      row: null,
      space: null,
      availableDate: null,
      firstSeenAt: 0,
      imageUrl: null,
      detailsUrl: null,
    });
    const list = StructuredData.vehicles("Inventory", 250, 100, [vehicle]);
    expect(list).toMatchObject({
      numberOfItems: 250,
      itemListElement: [
        {
          position: 101,
          item: { name: "2003 HONDA ACCORD EX", vehicleModelDate: "2003" },
        },
      ],
    });
    expect(JSON.stringify(list)).not.toContain("color");
  });
});
