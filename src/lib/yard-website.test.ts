import { expect, test } from "bun:test";
import { pypYardWebsite, resolveYardWebsite } from "./yard-website";

test("accepts published relative PYP store pages and derives matching yard inventory from vehicle URLs", () => {
  expect(
    pypYardWebsite(
      "/locations/fl/west-palm-beach/451-benoist-farms-road/",
      "1196",
    ),
  ).toBe(
    "https://www.pyp.com/locations/fl/west-palm-beach/451-benoist-farms-road/",
  );
  expect(
    pypYardWebsite(
      "https://www.pyp.com/inventory/west-palm-beach-1196/2014-ford-focus/",
      "1196",
    ),
  ).toBe("https://www.pyp.com/inventory/west-palm-beach-1196/");
  expect(
    pypYardWebsite("https://www.pyp.com/inventory/other-1/", "1196"),
  ).toBeNull();
  expect(
    pypYardWebsite(
      "https://evil.example/locations/fl/west-palm-beach/street/",
      "1196",
    ),
  ).toBeNull();
});

test("rejects insecure PYP links", () => {
  expect(
    pypYardWebsite(
      "http://www.pyp.com/inventory/west-palm-beach-1196/",
      "1196",
    ),
  ).toBeNull();
});

test.each([
  [
    "Pull-A-Part - Montgomery",
    "AL",
    "https://www.pullapart.com/locations/alabama/montgomery/",
  ],
  [
    "Pull-A-Part - Montgomery",
    "Alabama",
    "https://www.pullapart.com/locations/alabama/montgomery/",
  ],
  [
    "U-Pull-&-Pay - West Palm Beach",
    "Florida",
    "https://www.upullandpay.com/locations/florida/west-palm-beach/",
  ],
  [
    "Pull-A-Part - Columbia",
    "South Carolina",
    "https://www.pullapart.com/locations/s-carolina/columbia/",
  ],
  [
    "U-Pull-&-Pay - West Palm Beach",
    "FL",
    "https://www.upullandpay.com/locations/florida/west-palm-beach/",
  ],
  [
    "Pull-A-Part - Atlanta South",
    "GA",
    "https://www.pullapart.com/locations/georgia/atlanta-south/",
  ],
  [
    "Pull-A-Part - Columbia",
    "SC",
    "https://www.pullapart.com/locations/s-carolina/columbia/",
  ],
])("resolves the published location route for %s", (name, state, href) => {
  expect(
    resolveYardWebsite({ source: "pullapart", code: "13", name, state }),
  ).toEqual({ kind: "yard", href });
});

test("labels known provider entry points honestly and never invents an independent business website", () => {
  expect(
    resolveYardWebsite({
      source: "constructor",
      code: "unknown",
      name: "Unknown",
      state: "FL",
    }),
  ).toBeNull();
  expect(
    resolveYardWebsite({
      source: "gopullit",
      code: "GPI-TALLAHASSEE",
      name: "GO Pull-It - Tallahassee",
      state: "FL",
    }),
  ).toEqual({ kind: "provider", href: "https://gopullit.com/" });
  expect(
    resolveYardWebsite({
      source: "autorecycler",
      code: "unverified",
      name: "Independent yard",
      state: "FL",
    }),
  ).toBeNull();
  expect(
    resolveYardWebsite({
      source: "autorecycler",
      code: "1348695171700984260__LOOKUP__1708055368961x545475433275588600",
      name: "Kiker's U Pull It",
      state: "FL",
    }),
  ).toBeNull();
  expect(
    resolveYardWebsite({
      source: "autorecycler",
      code: "1348695171700984260__LOOKUP__1708055368961x545475433275588600",
      name: "Kiker's U Pull It",
      state: "FL",
      websiteUrl: "https://app.autorecycler.io/inventory/kikers-u-pull-it",
    }),
  ).toEqual({
    kind: "yard",
    href: "https://app.autorecycler.io/inventory/kikers-u-pull-it",
  });
});
