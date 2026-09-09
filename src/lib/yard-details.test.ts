import { describe, expect, test } from "bun:test";
import { getYardDetails } from "./yard-details";
import { Yard } from "./yard";

const inventory = {
  source: "pullapart",
  name: "Montgomery",
  city: "Montgomery",
  state: "AL",
  lat: 32.3,
  lng: -86.3,
};
const metadata: Yard = {
  source: "pullapart",
  code: "10",
  name: "Pull-A-Part - Montgomery",
  operator: "Pull-A-Part",
  city: "Montgomery",
  state: "AL",
  address: "4526 Norman Bridge Rd",
  postalCode: "36105",
  lat: null,
  lng: null,
  websiteUrl: "https://www.pullapart.com/locations/alabama/montgomery/",
  phone: "334-834-5880",
  email: null,
};

describe("yard directory metadata", () => {
  test("uses the stored business name and contact details, with an address-based map search", () => {
    const details = getYardDetails(inventory, metadata);
    expect(details.name).toBe(metadata.name);
    expect(details.websiteUrl).toBe(metadata.websiteUrl);
    expect(details.phone).toBe(metadata.phone);
    expect(new URL(details.mapsUrl).searchParams.get("query")).toBe(
      "Pull-A-Part - Montgomery, 4526 Norman Bridge Rd, Montgomery, AL, 36105",
    );
    expect(details.lat).toBe(inventory.lat);
  });

  test("prefers yard coordinates over inventory ZIP centroids", () => {
    const details = getYardDetails(inventory, {
      ...metadata,
      lat: 32.32,
      lng: -86.31,
    });
    expect([details.lat, details.lng]).toEqual([32.32, -86.31]);
  });

  test("keeps legacy inventory usable without fabricating contact details", () => {
    const details = getYardDetails(inventory, null);
    expect(details.name).toBe("Pull-A-Part / U-Pull-&-Pay - Montgomery");
    expect(details.websiteUrl).toBeNull();
    expect(details.phone).toBeNull();
    expect(details.email).toBeNull();
    expect(
      getYardDetails(
        { ...inventory, source: "row52", name: "Kiker's U Pull It" },
        null,
      ).name,
    ).toBe("Kiker's U Pull It");
    expect(
      getYardDetails(
        { ...inventory, source: "pyp", name: "Pick Your Part - Sun Valley" },
        null,
      ).name,
    ).toBe("Pick Your Part - Sun Valley");
  });

  test("does not publish shared homepages, aggregator pages, or unsafe URLs", () => {
    for (const websiteUrl of [
      "https://www.pullapart.com/",
      "https://www.pyp.com/",
      "https://gopullit.com/",
      "https://upullitne.com/",
      "https://row52.com/Vehicle/123",
      "https://autorecycler.io/details/123",
      "javascript:alert(1)",
      "https://user:password@yard.example/",
    ]) {
      expect(
        getYardDetails(inventory, { ...metadata, websiteUrl }).websiteUrl,
      ).toBeNull();
    }
  });

  test("supports a website dedicated to a single yard", () => {
    expect(Yard.website("https://upullitdavie.com/")).toBe(
      "https://upullitdavie.com/",
    );
  });

  test("validates identity, coordinates, and email at the ingestion boundary", () => {
    expect(Yard.parse(metadata).success).toBe(true);
    for (const invalid of [
      { code: "" },
      { source: "unknown" },
      { lat: 95, lng: 10 },
      { lat: 30, lng: null },
      { email: "bad\r\nBcc: somebody" },
    ]) {
      expect(Yard.parse({ ...metadata, ...invalid }).success).toBe(false);
    }
  });
});
