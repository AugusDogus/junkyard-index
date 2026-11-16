import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { z } from "zod";
import { iisCards, iisDirectory, iisDocument } from "./urgiis-catalog";

const probes = z
  .array(
    z.object({
      tenant: z.string(),
      url: z.string().url(),
      label: z.string(),
      mode: z.enum(["browser", "plain", "firefox"]),
      status: z.number(),
      exit: z.number(),
      startedAt: z.number(),
      html: z.string().nullable(),
    }),
  )
  .parse(
    JSON.parse(
      brotliDecompressSync(
        readFileSync(
          new URL(
            "./urgiis-test-fixtures/retry-probes.json.br",
            import.meta.url,
          ),
        ),
      ).toString(),
    ),
  );

for (const { code, urgid, count } of [
  { code: "az", urgid: "OK09", count: 1 },
  { code: "southwest", urgid: "UT11", count: 5 },
  { code: "norbs", urgid: "EE91", count: 123 },
  { code: "quick-recovery", urgid: "QQ32", count: 4 },
  { code: "riverbend", urgid: "NN82", count: 58 },
  { code: "lambert", urgid: "MS06", count: 3 },
]) {
  test(`${code}'s previously failing model recovers in spaced probes with both header sets`, () => {
    const recovered = probes.filter(
      (p) =>
        p.tenant === code &&
        p.label.startsWith("isolated-") &&
        p.status === 200 &&
        p.exit === 0,
    );
    expect(recovered.length).toBeGreaterThanOrEqual(2);
    expect(new Set(recovered.map((p) => p.mode))).toEqual(
      new Set(["browser", "plain"]),
    );
    const first = recovered[0];
    const last = recovered.at(-1);
    if (!first || !last)
      throw new Error("Missing spaced recovery evidence for " + code);
    expect(last.startedAt - first.startedAt).toBeGreaterThanOrEqual(180);
    for (let index = 1; index < recovered.length; index++) {
      const previous = recovered[index - 1];
      const current = recovered[index];
      if (!previous || !current) throw new Error("Missing consecutive probe");
      expect(current.startedAt - previous.startedAt).toBeGreaterThanOrEqual(
        120,
      );
    }
    for (const probe of recovered) {
      if (!probe.html)
        throw new Error("Missing recovered response at " + probe.url);
      const page = iisCards(probe.html, {
        origin: new URL(probe.url).origin,
        urgid,
        pathStyle: "parts",
      });
      expect(page.records).toHaveLength(count);
      expect(page.capped).toBe(false);
    }
  });
}

test("Quick Recovery's failed response names a site-side Redis connection error", () => {
  const failure = probes.find(
    (p) => p.tenant === "quick-recovery" && p.status === 500,
  );
  expect(failure?.html).toContain("Error establishing a Redis connection");
});

test("Lambert's historical H2 failures name Redis and database connection errors", () => {
  const historical = z
    .object({
      responses: z.array(z.object({ status: z.number(), html: z.string() })),
    })
    .parse(
      JSON.parse(
        brotliDecompressSync(
          readFileSync(
            new URL(
              "./urgiis-test-fixtures/lambert-retry-failures.json.br",
              import.meta.url,
            ),
          ),
        ).toString(),
      ),
    );
  expect(historical.responses.map((r) => r.status)).toEqual([500, 500]);
  const bodies = historical.responses.map((r) => r.html).join("\n");
  expect(bodies).toContain("Error establishing a Redis connection");
  expect(bodies).toContain("Error establishing a database connection");
});

test("MARS blocks Chrome but serves its native supplier document to Firefox", () => {
  const site = {
    origin: "https://swaptheuniverse.com",
    urgid: "OH25",
    pathStyle: "parts",
  } as const;
  for (const index of [1, 2]) {
    const chrome = probes.find(
      (p) => p.tenant === "mars" && p.label === `owner-chrome-${index}`,
    );
    const firefox = probes.find(
      (p) => p.tenant === "mars" && p.label === `owner-firefox-${index}`,
    );
    expect(chrome?.status).toBe(403);
    expect(chrome?.html).toContain("Cloudflare");
    expect(firefox?.status).toBe(200);
    if (!chrome?.html || !firefox?.html)
      throw new Error("Missing controlled MARS User-Agent comparison");
    const blocked = chrome.html;
    expect(() => iisDocument(blocked, site)).toThrow();
    expect(iisDocument(firefox.html, site)).toContain("MARS");
  }
});

test("Lake Point's exact supplier bundles cover live directories, models and arrivals", () => {
  const site = {
    origin: "https://lakepointauto.com",
    urgid: "UU23",
    pathStyle: "parts",
  } as const;
  for (const probe of probes.filter(
    (p) => p.tenant === "lakepoint" && p.status === 200,
  )) {
    if (!probe.html)
      throw new Error("Missing Lake Point response at " + probe.url);
    if (probe.label === "ownership-makes")
      expect(iisDirectory(probe.html, site).length).toBeGreaterThan(0);
    else if (probe.label.startsWith("ownership-model"))
      expect(iisCards(probe.html, site).records.length).toBeGreaterThan(0);
    else if (probe.label === "ownership-arrivals")
      expect(
        iisCards(probe.html, site, "arrivals").records.length,
      ).toBeGreaterThan(0);
  }
});
