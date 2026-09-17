import { describe, expect, test } from "bun:test";
import { fetchAutorecyclerYardWebsites } from "./autorecycler-website";
import { Yard } from "~/lib/yard";
import { resolveYardWebsite } from "~/lib/yard-website";

const columbus =
  "1348695171700984260__LOOKUP__1726602417880x199387504054651780";
const atlanta = "1348695171700984260__LOOKUP__1716932435477x905965313898837800";
const siteId = "1716935969976x139110746251611460";
const reference = `1348695171700984260__LOOKUP__${siteId}`;
const slug = "ez-pull-n-pay-atlanta";
const href = `https://app.autorecycler.io/inventory/${slug}`;

function organization(id: string, website: string | null = reference) {
  return {
    _id: id.split("__LOOKUP__").at(-1),
    _type: "custom.organization",
    found: true,
    _source: { website_custom_website: website },
  };
}

function website(Slug: string | undefined = slug) {
  return {
    _id: siteId,
    _type: "custom.website",
    found: true,
    _source: { Slug },
  };
}

describe("AutoRecycler hosted yard websites", () => {
  test("follows explicit organization references, including shared business sites", async () => {
    const requests: string[][] = [];
    const urls = await fetchAutorecyclerYardWebsites(
      [columbus, atlanta],
      async (ids) => {
        requests.push(ids);
        return requests.length === 1
          ? { docs: [organization(atlanta), organization(columbus)] }
          : { docs: [website()] };
      },
    );
    expect(requests).toEqual([
      ["1726602417880x199387504054651780", "1716932435477x905965313898837800"],
      [siteId],
    ]);
    expect(urls.get(columbus)).toBe(href);
    expect(urls.get(atlanta)).toBe(href);
    const parsed = Yard.parse({
      source: "autorecycler",
      code: columbus,
      name: "EZ Pull N Pay Columbus",
      operator: null,
      address: null,
      city: "Columbus",
      state: "GA",
      postalCode: null,
      lat: null,
      lng: null,
      phone: null,
      email: null,
      websiteUrl: urls.get(columbus),
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw parsed.error;
    expect(resolveYardWebsite(parsed.data)).toEqual({ kind: "yard", href });
  });

  test("uses the published record route when a website has no slug", async () => {
    let calls = 0;
    const urls = await fetchAutorecyclerYardWebsites([columbus], async () =>
      ++calls === 1
        ? { docs: [organization(columbus)] }
        : { docs: [{ ...website(), _source: {} }] },
    );
    expect(urls.get(columbus)).toBe(
      `https://app.autorecycler.io/inventory/${siteId}`,
    );
  });

  test("keeps genuinely absent websites null without making a second request", async () => {
    let calls = 0;
    const urls = await fetchAutorecyclerYardWebsites([columbus], async () => {
      calls++;
      return { docs: [organization(columbus, null)] };
    });
    expect(urls.get(columbus)).toBeNull();
    expect(calls).toBe(1);
  });

  test.each([
    {},
    { docs: [] },
    { docs: [organization(atlanta)] },
    { docs: [organization(columbus), organization(columbus)] },
    { docs: [organization(columbus)], error: "provider failed" },
    { docs: [{ ...organization(columbus), error: "provider failed" }] },
    { docs: [{ ...organization(columbus), _type: "custom.inventory" }] },
    { docs: [organization(columbus, "../../unrelated")] },
  ])(
    "rejects malformed/partial/error responses instead of clearing stored links: %j",
    async (response) => {
      await expect(
        fetchAutorecyclerYardWebsites([columbus], async () => response),
      ).rejects.toThrow();
    },
  );

  test("propagates transport failure", async () => {
    await expect(
      fetchAutorecyclerYardWebsites([columbus], async () => {
        throw new Error("HTTP 403");
      }),
    ).rejects.toThrow("HTTP 403");
  });

  test.each([
    "../details/123",
    "//evil.example",
    "yard?redirect=evil",
    "yard#fragment",
    "",
  ])("rejects invalid website slugs: %s", async (invalidSlug) => {
    let calls = 0;
    await expect(
      fetchAutorecyclerYardWebsites([columbus], async () =>
        ++calls === 1
          ? { docs: [organization(columbus)] }
          : { docs: [website(invalidSlug)] },
      ),
    ).rejects.toThrow();
  });

  test("allows hosted storefront routes but rejects generic and vehicle-level routes", () => {
    expect(Yard.website(href)).toBe(href);
    expect(
      Yard.website(
        "https://ario.autorecycler.io/yard/ez-pull-n-pay-atlanta?embed=1",
      ),
    ).toBe("https://ario.autorecycler.io/yard/ez-pull-n-pay-atlanta?embed=1");
    for (const invalid of [
      "https://app.autorecycler.io/",
      "https://app.autorecycler.io/buy",
      "https://app.autorecycler.io/details/123",
      "https://autorecycler.io/inventory/yard",
      "https://evil.autorecycler.io/inventory/yard",
      "http://app.autorecycler.io/inventory/yard",
      "https://app.autorecycler.io/inventory/a/b",
    ])
      expect(Yard.website(invalid)).toBeNull();
  });
});
