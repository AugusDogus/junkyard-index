import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { expect, test } from "bun:test";
import { Effect } from "effect";
import { z } from "zod";
import { VANDERHAAGS_YARDS } from "./vanderhaags-yards";
import {
  parseVanderHaagsPage,
  vanderHaagsCatalogHash,
} from "./vanderhaags-catalog";
import {
  streamVanderHaagsInventoryFromSource,
  type VanderHaagsStreamResult,
} from "./vanderhaags-connector";
import { type VanderHaagsCursor } from "./vanderhaags-cursor";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-source";
import type { CanonicalVehicle } from "./types";

const fixture = z
  .object({
    opening: z.array(z.string()),
    closing: z.array(z.string()),
    details: z.array(z.object({ id: z.string(), html: z.string() })),
  })
  .parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL(
            "./fixtures/vanderhaags/multi-yard-census.json.gz",
            import.meta.url,
          ),
        ),
      ).toString("utf8"),
    ),
  );
const receipt = z
  .object({
    yards: z.array(
      z.object({
        code: z.string(),
        census: z.number(),
        accepted: z.number(),
        rejected: z.number(),
        floor: z.number(),
      }),
    ),
  })
  .parse(
    JSON.parse(
      readFileSync(
        new URL(
          "../../../docs/runbooks/vanderhaags-qualification.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
const details = new Map(fixture.details.map((d) => [d.id, d.html]));
const now = Date.parse("2026-11-18T12:00:00Z");

async function replay(previousCursor?: VanderHaagsCursor, runAt = now) {
  const vehicles: CanonicalVehicle[] = [];
  let cursor: VanderHaagsCursor = { source: "vanderhaags", phase: "start" };
  let requests = 0;
  let detailRequests = 0;
  while (cursor.phase !== "complete") {
    let catalogPass = 0;
    const result: VanderHaagsStreamResult = await Effect.runPromise(
      streamVanderHaagsInventoryFromSource(
        {
          startCursor: cursor,
          previousCursor,
          now: () => runAt,
          onBatch: (batch) =>
            Effect.sync(() => {
              vehicles.push(...batch);
            }),
        },
        {
          fetchPage: (path) =>
            Effect.try(() => {
              requests++;
              const url = new URL(path, "https://www.vanderhaags.com");
              const page = Number(url.searchParams.get("page") ?? 1);
              if (url.pathname === "/New-Salvage.php" && page === 1)
                catalogPass++;
              const body =
                url.pathname === "/New-Salvage.php"
                  ? (catalogPass === 1 ? fixture.opening : fixture.closing)[
                      page - 1
                    ]
                  : details.get(url.searchParams.get("part") ?? "");
              if (url.pathname === "/detailview.php") detailRequests++;
              if (!body)
                throw new Error(
                  "Uncaptured Vander Haags replay request: " + path,
                );
              return body;
            }),
        },
      ),
    );
    cursor = parseDurableSourceCursor(
      "vanderhaags",
      serializeDurableSourceCursor(result.cursor),
    );
  }
  return { cursor, vehicles, requests, detailRequests };
}

test("complete captured multi-yard census and following daily run preserve admission and reduce detail reads", async () => {
  const opening = fixture.opening.flatMap(
    (html, index) => parseVanderHaagsPage(html, index + 1).donors,
  );
  const closing = fixture.closing.flatMap(
    (html, index) => parseVanderHaagsPage(html, index + 1).donors,
  );
  expect(opening).toHaveLength(2116);
  expect(vanderHaagsCatalogHash(closing)).toBe(vanderHaagsCatalogHash(opening));
  expect(new Set(fixture.details.map((d) => d.id)).size).toBe(opening.length);
  for (const yard of VANDERHAAGS_YARDS) {
    const evidence = receipt.yards.find((y) => y.code === yard.yard.code);
    expect(evidence).toBeDefined();
    expect(opening.filter((d) => d.yard === yard.catalogLabel)).toHaveLength(
      evidence?.census ?? 0,
    );
    expect(evidence?.floor).toBe(yard.minimumInventory);
  }
  const cold = await replay();
  expect(cold.detailRequests).toBe(2116);
  expect(cold.requests).toBe(3006);
  expect(new Set(cold.vehicles.map((v) => v.vin)).size).toBe(
    cold.vehicles.length,
  );
  for (const yard of receipt.yards)
    expect(
      cold.vehicles.filter((v) => v.locationCode === yard.code),
    ).toHaveLength(yard.accepted);
  const daily = await replay(cold.cursor, now + 24 * 60 * 60 * 1000);
  expect(daily.detailRequests).toBe(352);
  expect(daily.requests).toBe(507);
  expect(daily.vehicles).toEqual(cold.vehicles);
  const widerSlice = await replay(cold.cursor, now + 3 * 24 * 60 * 60 * 1000);
  expect(widerSlice.detailRequests).toBe(353);
  expect(widerSlice.requests).toBe(508);
  expect(widerSlice.vehicles).toEqual(cold.vehicles);
}, 180_000);
