import { describe, expect, test } from "bun:test";
import { getYardDetails } from "./yard-details";

const montgomery = {
  source: "pullapart",
  name: "Montgomery",
  city: "Montgomery",
  state: "AL",
  detailsUrl: "https://www.pullapart.com/inventory/search/?LocationID=10",
};

describe("yard details", () => {
  test("identifies the operator for city-only names and builds a business map search", () => {
    const details = getYardDetails(montgomery);
    expect(details.name).toBe("Pull-A-Part - Montgomery");
    expect(details.websiteUrl).toBe("https://www.pullapart.com/");
    expect(new URL(details.mapsUrl).searchParams.get("query")).toBe(
      "Pull-A-Part - Montgomery, Montgomery, AL",
    );
  });

  test("distinguishes U-Pull-&-Pay yards on the shared ingestion source", () => {
    expect(
      getYardDetails({
        ...montgomery,
        name: "Denver",
        detailsUrl: "https://www.upullandpay.com/inventory/search/",
      }).name,
    ).toBe("U-Pull-&-Pay - Denver");
  });

  test("does not duplicate existing operator names", () => {
    expect(
      getYardDetails({ ...montgomery, name: "Pull-A-Part Montgomery" }).name,
    ).toBe("Pull-A-Part Montgomery");
    expect(
      getYardDetails({
        ...montgomery,
        source: "pyp",
        name: "Pick Your Part - Sun Valley",
        detailsUrl: "https://www.pyp.com/inventory/sun-valley-1229/car/",
      }).name,
    ).toBe("Pick Your Part - Sun Valley");
  });

  test("identifies city-only Pick Your Part yards", () => {
    expect(
      getYardDetails({
        ...montgomery,
        source: "pyp",
        name: "Sun Valley",
        detailsUrl: null,
      }).name,
    ).toBe("LKQ Pick Your Part - Sun Valley");
  });

  test("preserves independent yard names without presenting an aggregator as the yard website", () => {
    for (const source of ["row52", "autorecycler", "unknown", "constructor"]) {
      const details = getYardDetails({
        ...montgomery,
        source,
        name: "Kiker's U Pull It",
        detailsUrl: "https://row52.com/Vehicle/123",
      });
      expect(details.name).toBe("Kiker's U Pull It");
      expect(details.websiteUrl).toBeNull();
    }
  });

  test("rejects malformed, unsafe, and unrelated website URLs", () => {
    for (const detailsUrl of [
      null,
      "invalid",
      "javascript:alert(1)",
      "https://www.pullapart.com.evil.test/",
      "https://user:password@www.pullapart.com/",
    ]) {
      expect(
        getYardDetails({ ...montgomery, detailsUrl }).websiteUrl,
      ).toBeNull();
    }
  });

  test("links direct operators to their website without vehicle-specific paths", () => {
    for (const [source, host] of [
      ["pyp", "www.pyp.com"],
      ["gopullit", "gopullit.com"],
      ["upullitne", "upullitne.com"],
      ["upullitdavie", "upullitdavie.com"],
    ] as const) {
      expect(
        getYardDetails({
          ...montgomery,
          source,
          detailsUrl: `https://${host}/inventory/car?vin=123`,
        }).websiteUrl,
      ).toBe(`https://${host}/`);
    }
  });
});
