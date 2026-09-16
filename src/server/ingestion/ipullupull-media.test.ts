import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  fetchIPullUPullMedia,
  parseIPullUPullMediaPage,
} from "./ipullupull-media";
import { beetleImage as image, mediaPage } from "./fixtures/ipullupull-media";
const beetle = { stock: "STK057825", vin: "1122642450", city: "STOCKTON" };
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("extracts both reported vintage Beetles from captured public card markup", async () => {
  const html = await Bun.file(
    new URL("./fixtures/ipullupull-beetle-media.html", import.meta.url),
  ).text();
  expect(parseIPullUPullMediaPage(html, 1).items).toEqual([
    { ...beetle, imageUrl: image },
    {
      stock: "SAC048605",
      vin: "1132387763",
      city: "SACRAMENTO",
      imageUrl:
        "https://ipullupull.com/wp-content/uploads/ipullupull-optimized/7e/7ed282ecbe462cfe-large.webp",
    },
  ]);
});

test("reads the real vehicle gallery, including pre-1981 VINs, without using part photos", () => {
  const page = parseIPullUPullMediaPage(mediaPage([beetle]), 1);
  expect(page.items).toEqual([{ ...beetle, imageUrl: image }]);
  expect(
    parseIPullUPullMediaPage(
      mediaPage([{ ...beetle, imageUrl: null }]).replace(
        'data-parts="[]"',
        `data-parts='[{"images":[{"url":"${image}"}]}]'`,
      ),
      1,
    ).items[0]?.imageUrl,
  ).toBeNull();
});

test.each([
  ["truncated", mediaPage([beetle]).replace("</html>", "")],
  [
    "missing gallery",
    mediaPage([beetle]).replace("data-gallery=", "data-unknown="),
  ],
  [
    "invalid gallery",
    mediaPage([beetle]).replace("&quot;url&quot;", "&quot;unknown&quot;"),
  ],
  [
    "placeholder",
    mediaPage([{ ...beetle, imageUrl: "https://ipullupull.com/logo.png" }]),
  ],
  ["wrong page", mediaPage([beetle], 2)],
  ["short page", mediaPage([beetle], 1, 100)],
  [
    "duplicate VIN label",
    mediaPage([beetle]).replace("</dl>", "<dt>VIN</dt><dd>wrong</dd></dl>"),
  ],
])("rejects %s media before emitting inventory", (_label, html) => {
  expect(() => parseIPullUPullMediaPage(html, 1)).toThrow();
});

test("missing VIN on part-only and invalid cards cannot match an eligible CSV identity", () => {
  expect(
    parseIPullUPullMediaPage(
      mediaPage([beetle]).replace("<dt>VIN</dt>", "<dt>Other</dt>"),
      1,
    ).items[0]?.vin,
  ).toBe("");
});

test("accepts upstream original asset uploads as well as optimized variants", () => {
  const imageUrl =
    "https://ipullupull.com/wp-content/uploads/ipullupull-catalog/FRE111479/IMG_2020-scaled.jpg";
  expect(
    parseIPullUPullMediaPage(
      mediaPage([{ ...beetle, stock: "FRE111479", imageUrl }]),
      1,
    ).items[0]?.imageUrl,
  ).toBe(imageUrl);
});

test("paginates in bounded bulk requests through the shared request gate", async () => {
  const items = Array.from({ length: 97 }, (_, i) => ({
    ...beetle,
    stock: `STK${i}`,
  }));
  let requests = 0;
  let gates = 0;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get("ipull_inventory_pricing_page"));
      expect(url.searchParams.get("ipull_inventory_pricing_perpage")).toBe(
        "96",
      );
      expect(url.searchParams.get("ipull_inventory_pricing_sort")).toBe(
        "stock_number",
      );
      requests++;
      return new Response(
        mediaPage(items.slice((page - 1) * 96, page * 96), page, 97),
        { headers: { "content-type": "text/html" } },
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  const media = await Effect.runPromise(
    fetchIPullUPullMedia((request) =>
      Effect.sync(() => {
        gates++;
      }).pipe(Effect.zipRight(request)),
    ),
  );
  expect(media.size).toBe(97);
  expect(requests).toBe(2);
  expect(gates).toBe(2);
});

test.each(["changed total", "repeated page", "later HTTP failure"])(
  "rejects %s instead of accepting incomplete enrichment",
  async (failure) => {
    const items = Array.from({ length: 97 }, (_, i) => ({
      ...beetle,
      stock: `STK${i}`,
    }));
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const page = Number(
          new URL(String(input)).searchParams.get(
            "ipull_inventory_pricing_page",
          ),
        );
        if (page === 2 && failure === "later HTTP failure")
          return new Response("unavailable", { status: 403 });
        const rows =
          page === 1
            ? items.slice(0, 96)
            : failure === "repeated page"
              ? items.slice(0, 1)
              : items.slice(96);
        if (page === 2 && failure === "changed total")
          rows.push({ ...beetle, stock: "NEW" });
        return new Response(
          mediaPage(
            rows,
            page,
            page === 2 && failure === "changed total" ? 98 : 97,
          ),
          { headers: { "content-type": "text/html" } },
        );
      },
      { preconnect: originalFetch.preconnect },
    );
    await expect(
      Effect.runPromise(fetchIPullUPullMedia((request) => request)),
    ).rejects.toThrow(/Media enrichment unavailable/);
  },
);

const invalidResponses: {
  label: string;
  status: number;
  headers: Record<string, string>;
}[] = [
  { label: "partial status", status: 206, headers: {} },
  {
    label: "partial range",
    status: 200,
    headers: { "content-range": "bytes 0-100/1000" },
  },
  {
    label: "paginated HTTP",
    status: 200,
    headers: { link: '</next>; rel="alternate next"' },
  },
  {
    label: "wrong MIME",
    status: 200,
    headers: { "content-type": "text/plain" },
  },
  {
    label: "truncated length",
    status: 200,
    headers: { "content-length": "999999" },
  },
];
test.each(invalidResponses)(
  "rejects $label responses",
  async ({ status, headers }) => {
    globalThis.fetch = Object.assign(
      async () =>
        new Response(mediaPage([beetle]), {
          status,
          headers: { "content-type": "text/html", ...headers },
        }),
      { preconnect: originalFetch.preconnect },
    );
    await expect(
      Effect.runPromise(fetchIPullUPullMedia((request) => request)),
    ).rejects.toThrow(/Media enrichment unavailable/);
  },
);

test("bounds media body size before parsing", async () => {
  globalThis.fetch = Object.assign(
    async () =>
      new Response("x".repeat(4 * 1024 * 1024 + 1), {
        headers: { "content-type": "text/html" },
      }),
    { preconnect: originalFetch.preconnect },
  );
  await expect(
    Effect.runPromise(fetchIPullUPullMedia((request) => request)),
  ).rejects.toThrow(/4 MiB/);
});
