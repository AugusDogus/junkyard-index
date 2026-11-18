import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Effect } from "effect";
import { z } from "zod";
import { SpartanCursor } from "./spartan-cursor";
import { SpartanPage } from "./spartan-parser";
import { SpartanOwner } from "./spartan-owner";
import { spartanSnapshot } from "./spartan-snapshot";
import { streamSpartanInventory } from "./spartan-connector";
import {
  SPARTAN_MINIMUM,
  SPARTAN_OWNER,
  SPARTAN_YARD,
  spartanPageUrl,
} from "./spartan-yard-metadata";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-cursor";
import { IngestionSourceFlags } from "./ingestion-source-flags";
import type { CanonicalVehicle } from "./types";

const root = new URL("./spartan-test-fixtures/", import.meta.url);
const bytes = (name: string) =>
  gunzipSync(readFileSync(new URL(name + ".gz", root)));
const body = (name: string) => bytes(name).toString("utf8");
const pages = (phase: string) =>
  (["auto", "truck"] as const).flatMap((kind) =>
    Array.from({ length: kind === "auto" ? 79 : 3 }, (_, index) =>
      SpartanPage.parse(body(`${phase}-${kind}-${index + 1}`), kind, index + 1),
    ),
  );

test("both complete API partitions reconcile 981 native donors and apply the unchanged identity guards", () => {
  const opening = pages("opening");
  expect(opening).toEqual(pages("closing"));
  SpartanOwner.parse(body("owner-opening"));
  SpartanOwner.parse(body("owner-closing"));
  const result = spartanSnapshot(opening, null);
  expect(result.accounting).toEqual({
    recordsProcessed: 981,
    recordsExcluded: 0,
    recordsRejected: 12,
    duplicateVehicles: 0,
  });
  expect(result.vehicles).toHaveLength(969);
  expect(result.observedVins).toHaveLength(975);
  expect(SPARTAN_MINIMUM).toBe(Math.floor(969 / 3));
  expect(
    result.vehicles.every(
      (row) => row.stateAbbr === "SC" && row.locationCode === "inman",
    ),
  ).toBe(true);
  expect(
    result.vehicles.find((row) => row.stockNumber === "1026-05"),
  ).toMatchObject({
    vin: "SALGS2WF6EA150544",
    year: 2014,
    detailsUrl: "https://www.spartanauto.parts/auto-catalog/1007",
    availableDate: null,
  });
  expect(() => spartanSnapshot(opening, 2000)).toThrow();
});

test("bounded durable replay closes every native page and the owner before publishing", async () => {
  const opening = pages("opening");
  let cursor = SpartanCursor.initial();
  let reads = 0;
  const emitted: CanonicalVehicle[] = [];
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      streamSpartanInventory({
        previousUniqueInventory: 969,
        startCursor: cursor,
        maxPages: 4,
        readPage: (url) =>
          Effect.sync(() => {
            const index = reads++;
            if (index === 0 || index === 165) {
              expect(url).toBe(SPARTAN_OWNER);
              return body(index === 0 ? "owner-opening" : "owner-closing");
            }
            const phase = index <= 82 ? "opening" : "closing";
            const page = opening[(index - 1) % 82];
            if (!page) throw new Error("Unexpected Spartan fixture request");
            expect(url).toBe(spartanPageUrl(page.kind, page.page));
            return body(`${phase}-${page.kind}-${page.page}`);
          }),
        onBatch: (rows) =>
          Effect.sync(() => {
            emitted.push(...rows);
          }),
      }),
    );
    cursor = SpartanCursor.parse(
      parseDurableSourceCursor(
        "spartan",
        serializeDurableSourceCursor(result.cursor),
      ),
    );
    if (result.status === "paused") expect(emitted).toHaveLength(0);
  }
  expect(reads).toBe(166);
  expect(emitted).toHaveLength(969);
  expect(IngestionSourceFlags.resolve({})).toContain("spartan");
  const replay = await Effect.runPromise(
    streamSpartanInventory({
      previousUniqueInventory: 969,
      startCursor: cursor,
      readPage: () => Effect.die("Completed census must not read again"),
      onBatch: () => Effect.die("Completed census must not publish again"),
    }),
  );
  expect(replay.count).toBe(0);
  expect(replay.pagesProcessed).toBe(0);
});

test("partial pages, missing partitions, repeated destinations and changed closing claims preserve prior inventory", async () => {
  const opening = pages("opening");
  expect(() =>
    SpartanPage.parse(body("opening-auto-1").slice(0, -1), "auto", 1),
  ).toThrow();
  expect(() => SpartanPage.parse(body("opening-auto-2"), "auto", 1)).toThrow();
  expect(() => SpartanPage.parse(body("opening-auto-1"), "truck", 1)).toThrow();
  expect(() =>
    SpartanOwner.parse(body("owner-opening").replaceAll("Inman", "Greenville")),
  ).toThrow();
  expect(() =>
    SpartanCursor.checkpoint({
      phase: "closing",
      startedAt: Date.now(),
      pages: opening.slice(0, 79),
      closed: 0,
    }),
  ).toThrow();
  expect(() =>
    SpartanCursor.checkpoint({
      phase: "opening",
      startedAt: Date.now(),
      pages: [opening[1]].filter((page) => page !== undefined),
    }),
  ).toThrow();
  const first = opening[0];
  if (!first || !first.rows[0]) throw new Error("Missing native donor fixture");
  expect(() =>
    SpartanCursor.checkpoint({
      phase: "opening",
      startedAt: Date.now(),
      pages: [
        {
          ...first,
          rows: first.rows
            .map(() => first.rows[0])
            .filter((row) => row !== undefined),
        },
      ],
    }),
  ).toThrow("repeats a donor destination");
  const cursor = SpartanCursor.checkpoint({
    phase: "closing",
    startedAt: Date.now(),
    pages: opening,
    closed: 0,
  });
  expect(() =>
    SpartanCursor.parse({ ...cursor, checksum: "changed" }),
  ).toThrow();
  let emitted = false;
  await expect(
    Effect.runPromise(
      streamSpartanInventory({
        previousUniqueInventory: 969,
        startCursor: cursor,
        readPage: () =>
          Effect.succeed(
            body("closing-auto-1").replace(
              "SALGS2WF6EA150544",
              "SALGS2WF6EA150545",
            ),
          ),
        onBatch: () =>
          Effect.sync(() => {
            emitted = true;
          }),
      }),
    ),
  ).rejects.toThrow();
  expect(emitted).toBe(false);
  await expect(
    Effect.runPromise(
      streamSpartanInventory({
        previousUniqueInventory: 969,
        startCursor: SpartanCursor.checkpoint({
          phase: "closing",
          startedAt: Date.now() - 2 * 60 * 60 * 1000 - 1000,
          pages: opening,
          closed: 0,
        }),
        readPage: () => Effect.die("Expired census must not read again"),
        onBatch: () =>
          Effect.die("Expired census must preserve prior inventory"),
      }),
    ),
  ).rejects.toThrow("expired");
});

test("saved receipts establish public donor destinations, location and recent image publication", () => {
  expect(body("native-auto")).toContain("SALGS2WF6EA150544");
  expect(body("native-truck")).toContain("1XKYDP9X5LJ359430");
  expect(body("owner-opening")).toContain(String(SPARTAN_YARD.lat));
  expect(body("owner-opening")).toContain(String(SPARTAN_YARD.lng));
  const photo = z
    .object({
      status: z.literal(200),
      headers: z.object({
        "last-modified": z.literal("Fri, 16 Oct 2026 16:21:06 GMT"),
      }),
    })
    .parse(JSON.parse(readFileSync(new URL("photo.json", root), "utf8")));
  expect(Date.parse(photo.headers["last-modified"])).toBeGreaterThan(
    Date.parse("2026-09-18"),
  );
  const receipts = z
    .array(
      z.object({
        file: z.string(),
        bytes: z.number(),
        sha256: z.string(),
        status: z.literal(200),
      }),
    )
    .parse(JSON.parse(readFileSync(new URL("requests.json", root), "utf8")));
  expect(receipts).toHaveLength(168);
  for (const r of receipts) {
    const raw = gunzipSync(readFileSync(new URL(r.file, root)));
    expect(raw.length).toBe(r.bytes);
    expect(createHash("sha256").update(raw).digest("hex")).toBe(r.sha256);
  }
});

test("donor identity survives absent optional stock, color and photos", () => {
  const feed = z
    .object({
      data: z.array(z.record(z.string(), z.unknown())),
      meta: z.unknown(),
    })
    .parse(JSON.parse(body("opening-auto-1")));
  const raw = JSON.stringify({
    ...feed,
    data: feed.data.map(({ stock, color, images, ...identity }) => {
      void stock;
      void color;
      void images;
      return identity;
    }),
  });
  const page = SpartanPage.parse(raw, "auto", 1);
  expect(page.rows.map((row) => row.vin)).toEqual(
    SpartanPage.parse(body("opening-auto-1"), "auto", 1).rows.map(
      (row) => row.vin,
    ),
  );
  expect(
    page.rows.every(
      (row) => row.stock === "" && row.color === null && row.imageUrl === null,
    ),
  ).toBe(true);
});
