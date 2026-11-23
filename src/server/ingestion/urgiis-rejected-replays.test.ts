import { iisCards } from "./urgiis-catalog";
import { expect, test } from "bun:test";
import { Effect } from "effect";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import { streamUrgiisInventory } from "./urgiis-connector";
import { UrgiisCursor } from "./urgiis-cursor";
import { urgiisError } from "./urgiis-client";
import { UrgiisReplayArchive } from "./urgiis-replay-archive";
import { validateUrgiisSnapshot } from "./urgiis-snapshot";
import type { UrgiisTenant } from "./urgiis-tenant";

const standard = {
  pathStyle: "parts",
  ownerPath: "/",
  makesPath: "/parts/makes/",
  cookie: "urg_hv=1",
  pacingMs: 3500,
  requestTimeoutMs: 90000,
  placeholderStocks: [],
  skipBlankVin: false,
  attribution: { kind: "site" },
} as const;

const cases: readonly {
  tenant: UrgiisTenant;
  optimisticStocks: readonly string[];
  emptyPath: string;
  rejection: string;
  optimisticRejection: string;
}[] = [
  {
    tenant: {
      ...standard,
      code: "tnt",
      transport: "native",
      origin: "https://picktnt.com",
      urgid: "UU50",
      arrivalsPath: "/recent-arrivals/",
      ownerClaims: [
        "TNT Auto Parts",
        "9042 Greenwood Road",
        "Greenwood, LA 71033",
      ],
      minimumInventory: 347,
      photoCodes: ["uu50"],
      yard: {
        source: "urgiis",
        code: "tnt",
        name: "TNT Auto Parts",
        operator: "TNT Auto Parts",
        address: "9042 Greenwood Road",
        city: "Greenwood",
        state: "LA",
        postalCode: "71033",
        lat: 32.442781318339,
        lng: -93.96234444712,
        phone: "318-938-7299",
        email: null,
        websiteUrl: "https://picktnt.com/",
      },
    },
    optimisticStocks: ["AFT", "NOF", "CPO", "DLRS"],
    emptyPath: "/parts/CHRYSLER/TOWN_-and_COUNTRY/",
    rejection: "252/1346 rejected",
    optimisticRejection: "155/1249 rejected",
  },
  {
    tenant: {
      ...standard,
      code: "borges",
      transport: "native",
      origin: "https://borgesauto.com",
      urgid: "MA15",
      arrivalsPath: "/latest-arrivals-2/",
      ownerClaims: [
        "Borges Foreign Auto Parts",
        "2200 Lewis Street",
        "Dighton, MA 02715",
      ],
      minimumInventory: 1220,
      photoCodes: ["ma15"],
      yard: {
        source: "urgiis",
        code: "borges",
        name: "Borges Foreign Auto Parts",
        operator: "Borges Foreign Auto Parts",
        address: "2200 Lewis Street",
        city: "Dighton",
        state: "MA",
        postalCode: "02715",
        lat: 41.8208961,
        lng: -71.1830139,
        phone: "508-669-6288",
        email: null,
        websiteUrl: "https://borgesauto.com/",
      },
    },
    optimisticStocks: ["MISC", "MIS", "NEW"],
    emptyPath: "/parts/CHRYSLER/TOWN_-and_COUNTRY/",
    rejection: "460/4167 rejected",
    optimisticRejection: "419/4126 rejected",
  },
];

for (const candidate of cases) {
  for (const placeholderStocks of [[], candidate.optimisticStocks]) {
    test(`${candidate.tenant.yard.name} complete replay rejects admission with ${placeholderStocks.length ? "optimistic unverified bins" : "no exclusions"}`, async () => {
      const tenant = { ...candidate.tenant, placeholderStocks };
      const archive = await UrgiisReplayArchive.open(
        tenant.code + "-rejected-census",
      );
      // Admission ratios still fail even independently of the earlier empty-page
      // guard. Assess the complete saved observations without publishing them.
      const snapshot = await UrgiisReplayArchive.assess(
        tenant.code + "-rejected-census",
        tenant,
      );
      expect(() => validateUrgiisSnapshot(snapshot, tenant)).toThrow(
        placeholderStocks.length
          ? candidate.optimisticRejection
          : candidate.rejection,
      );
      let cursor = UrgiisCursor.initial([tenant]);
      let reads = 0;
      const emptyResponses = new Map<string, string>();
      let emissions = 0;
      let rejected = false;
      try {
        while (cursor.phase !== "complete") {
          const outcome = await Effect.runPromise(
            streamUrgiisInventory({
              tenants: [tenant],
              startCursor: cursor,
              maxPages: 3,
              readPage: (url) =>
                Effect.tryPromise({
                  try: async () => {
                    if (emptyResponses.has(url)) {
                      reads++;
                      return emptyResponses.get(url) ?? "";
                    }
                    const response = await archive.next();
                    if (!response || response.url !== url)
                      throw new Error(
                        "Unexpected rejected census request: " + url,
                      );
                    reads++;
                    if (
                      new URL(url).pathname.split("/").filter(Boolean)
                        .length === 3 &&
                      /No Results/i.test(response.html) &&
                      iisCards(response.html, tenant).nativeEmpty
                    )
                      emptyResponses.set(url, response.html);
                    return response.html;
                  },
                  catch: (cause) =>
                    urgiisError("rejected census offline replay", cause),
                }),
              onBatch: () =>
                Effect.sync(() => {
                  emissions++;
                }),
            }).pipe(Effect.either),
          );
          if (outcome._tag === "Left") throw outcome.left;
          expect(outcome.right.status).not.toBe("failed");
          cursor = outcome.right.cursor;
          const done = cursor.completed[0];
          if (done && "blocked" in done) {
            // Coverage and admission failures each block only this tenant.
            const admission = placeholderStocks.length
              ? candidate.optimisticRejection
              : candidate.rejection;
            if (!done.blocked.includes("maximum is 1%")) {
              expect(done.blocked).toContain("snapshot " + tenant.code);
              expect(done.blocked).toContain(admission);
            }
            rejected = true;
          }
        }
        expect(rejected).toBe(true);
        expect(emissions).toBe(0);
        expect(reads).toBeLessThanOrEqual(
          archive.responseCount + emptyResponses.size,
        );
        expect(URGIIS_TENANTS.some((t) => t.code === tenant.code)).toBe(false);
      } finally {
        archive.close();
      }
    }, 120_000);
  }
}
