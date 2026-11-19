import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { inflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { soakMillerstownInventory } from "../../../scripts/soak-millerstown";
import { connectorChunkMetrics } from "./connector-chunk";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-cursor";
import { streamMillerstownInventoryWithRequestGate } from "./millerstown-connector";
import { MillerstownCursor } from "./millerstown-cursor";
import type { MillerstownCanonicalVehicle } from "./millerstown-donor";
import {
  MILLERSTOWN_FIXTURE_PDF_URL,
  millerstownHtmlFixture,
  millerstownOracleFixture,
  millerstownPdfFixture,
} from "./millerstown-test-fixtures";
import {
  MILLERSTOWN_INVENTORY_URL,
  MILLERSTOWN_ROOT_URL,
  MILLERSTOWN_YARD,
} from "./millerstown-yard-metadata";
import type { ProviderRequestGate } from "./provider-http-client";
import type { Yard } from "~/lib/yard";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const immediate: ProviderRequestGate = (request) => request;
type Body = string | Uint8Array;
async function replay(change?: (index: number, body: Body) => Body) {
  const root = await millerstownHtmlFixture("root");
  const inventory = await millerstownHtmlFixture("inventory");
  const pdf = await millerstownPdfFixture();
  const bodies = [root, inventory, pdf, inventory, pdf];
  const urls = [
    MILLERSTOWN_ROOT_URL,
    MILLERSTOWN_INVENTORY_URL,
    MILLERSTOWN_FIXTURE_PDF_URL,
    MILLERSTOWN_INVENTORY_URL,
    MILLERSTOWN_FIXTURE_PDF_URL,
  ];
  const requests: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const index = requests.length;
      const body = bodies[index];
      const url = urls[index];
      if (body === undefined || url === undefined)
        throw new Error("Unexpected extra native request");
      requests.push(String(input));
      expect(String(input)).toBe(url);
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("error");
      const mime = typeof body === "string" ? "text/html" : "application/pdf";
      expect(init?.headers).toEqual({
        "User-Agent": "JunkyardIndex/1.0",
        Accept: mime,
      });
      const changed = change ? change(index, body) : body;
      return new Response(
        typeof changed === "string" ? changed : Buffer.from(changed),
        {
          headers: {
            "content-type": mime,
            "content-length": String(Buffer.byteLength(changed)),
          },
        },
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}

test("five serial native reads emit the full oracle only after closing proof and round-trip real cursors", async () => {
  const requests = await replay();
  const oracle = await millerstownOracleFixture();
  let active = false;
  let gates = 0;
  const serial: ProviderRequestGate = (request) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        expect(active).toBe(false);
        active = true;
        gates++;
      }),
      () => request,
      () =>
        Effect.sync(() => {
          active = false;
        }),
    );
  const start = parseDurableSourceCursor(
    "millerstown",
    serializeDurableSourceCursor(MillerstownCursor.initial),
  );
  const emitted: MillerstownCanonicalVehicle[] = [];
  const originalYard = { ...MILLERSTOWN_YARD };
  let batches = 0;
  let yards = 0;
  const result = await soakMillerstownInventory((cursor, maxPages) =>
    Effect.runPromise(
      streamMillerstownInventoryWithRequestGate(
        {
          startCursor: cursor,
          maxPages,
          onYards: (batch: Yard[]) =>
            Effect.sync(() => {
              expect(requests).toHaveLength(5);
              expect(active).toBe(false);
              expect(batch).toEqual([MILLERSTOWN_YARD]);
              const yard = batch[0];
              expect(yard).not.toBe(MILLERSTOWN_YARD);
              if (yard) {
                yard.city = "Callback mutation";
                yard.lat = 0;
                yard.lng = 0;
              }
              batch.splice(0);
              yards++;
            }),
          onBatch: (batch) =>
            Effect.sync(() => {
              expect(requests).toHaveLength(5);
              expect(active).toBe(false);
              emitted.push(...batch);
              batches++;
            }),
        },
        serial,
      ),
    ),
  );
  expect(start).toEqual(MillerstownCursor.initial);
  expect(MILLERSTOWN_YARD).toEqual(originalYard);
  // The native sheet prints each of these VINs on two different vehicles.
  const conflicts = ["5GAER23708J268506", "2HKYF18427H509793"];
  expect(emitted).toEqual(
    oracle.canonical.filter((vehicle) => !conflicts.includes(vehicle.vin)),
  );
  expect({ gates, batches, yards }).toEqual({ gates: 5, batches: 1, yards: 1 });
  expect(result).toMatchObject({
    source: "millerstown",
    status: "complete",
    count: 411,
    pagesProcessed: 1,
    errors: [],
    observedVins: [
      "5GAER23708J268506",
      ...oracle.rejectedPresence,
      "2HKYF18427H509793",
    ],
    accounting: {
      recordsProcessed: 421,
      recordsExcluded: 0,
      recordsRejected: 10,
      duplicateVehicles: 0,
    },
  });
  expect(connectorChunkMetrics(result, emitted.length)).toEqual({
    vehiclesProcessed: 421,
    uniqueVehicles: 411,
    rejectedVehicles: 10,
    duplicateVehicles: 0,
  });
  const complete = parseDurableSourceCursor(
    "millerstown",
    serializeDurableSourceCursor(result.cursor),
  );
  const repeated = await Effect.runPromise(
    streamMillerstownInventoryWithRequestGate(
      {
        startCursor: complete,
        onBatch: () => Effect.die("Repeated complete cursor called callback"),
      },
      immediate,
    ),
  );
  expect(repeated).toMatchObject({
    count: 0,
    pagesProcessed: 0,
    observedVins: [],
    accounting: {
      recordsProcessed: 0,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    },
  });
  expect(requests).toHaveLength(5);
}, 20_000);

async function failsWithoutCallbacks(
  change: (index: number, body: Body) => Body,
  message: string,
  expectedReads: number,
) {
  const requests = await replay(change);
  const start = { ...MillerstownCursor.initial };
  let callbacks = 0;
  await expect(
    Effect.runPromise(
      streamMillerstownInventoryWithRequestGate(
        {
          startCursor: start,
          onBatch: () =>
            Effect.sync(() => {
              callbacks++;
            }),
          onYards: () =>
            Effect.sync(() => {
              callbacks++;
            }),
        },
        immediate,
      ),
    ),
  ).rejects.toThrow(message);
  expect(start).toEqual(MillerstownCursor.initial);
  expect(callbacks).toBe(0);
  expect(requests).toHaveLength(expectedReads);
}
for (const [name, needle, replacement] of [
  ["physical owner", "Millerstown Pic-A-Part Yard", "Another Operator"],
  ["full scope", "<title>Vehicles on Premises", "<title>Filtered Vehicles"],
  [
    "PDF link",
    "2026_11_12-Millerstown-Inventory.pdf",
    "2026_11_13-Millerstown-Inventory.pdf",
  ],
  ["viewer", "viewer?url=http", "viewer?url=xhttp"],
] as const)
  test(`closing ${name} drift emits neither yard nor donor callbacks`, async () => {
    await failsWithoutCallbacks(
      (index, body) =>
        index === 3 && typeof body === "string"
          ? body.replaceAll(needle, replacement)
          : body,
      "Millerstown",
      4,
    );
  }, 20_000);
test("foreign root ownership fails before any inventory request", async () => {
  await failsWithoutCallbacks(
    (index, body) =>
      index === 0 && typeof body === "string"
        ? body.replaceAll("3148 Lardintown Road", "Wrong Road")
        : body,
    "physical address",
    1,
  );
});
for (const position of ["middle", "tail"] as const)
  test(`full closing PDF hash detects ${position} byte changes`, async () => {
    await failsWithoutCallbacks(
      (index, body) => {
        if (index !== 4 || typeof body === "string") return body;
        const bytes = new Uint8Array(body);
        const offset =
          position === "middle"
            ? Math.floor(bytes.length / 2)
            : bytes.length - 3;
        const value = bytes[offset];
        if (value === undefined) throw new Error("Missing mutation byte");
        bytes[offset] = value ^ 1;
        return bytes;
      },
      "byte hashes differ",
      5,
    );
  }, 20_000);

async function changedPdf(change: (document: PDFDocument) => void) {
  const document = await PDFDocument.load(await millerstownPdfFixture());
  change(document);
  return document.save({
    useObjectStreams: false,
    updateFieldAppearances: false,
  });
}
function editContent(
  document: PDFDocument,
  change: (source: string, page: number) => string,
) {
  for (const [index, page] of document.getPages().entries()) {
    const stream = page.node.Contents();
    if (!(stream instanceof PDFRawStream))
      throw new Error("Missing raw native page stream");
    page.node.set(
      PDFName.of("Contents"),
      document.context.register(
        document.context.flateStream(
          change(inflateSync(stream.getContents()).toString("latin1"), index),
        ),
      ),
    );
  }
}
async function completes(pdf: Uint8Array) {
  await replay((index, body) => (index === 2 || index === 4 ? pdf : body));
  const emitted: MillerstownCanonicalVehicle[] = [];
  const result = await Effect.runPromise(
    streamMillerstownInventoryWithRequestGate(
      {
        onBatch: (batch) =>
          Effect.sync(() => {
            emitted.push(...batch);
          }),
      },
      immediate,
    ),
  );
  return { result, emitted };
}
test("a VIN repeated on a different row quarantines every row without stock merging", async () => {
  const pdf = await changedPdf((document) =>
    editContent(document, (source, page) =>
      page === 0
        ? source.replace(
            /(1 0 0 1 106\.7 525\.24 Tm[\s\S]*?)\[[\s\S]*?\] TJ/,
            "$1[(JH4DC4456YS013792)] TJ",
          )
        : source,
    ),
  );
  const { result, emitted } = await completes(pdf);
  expect(
    emitted.filter((vehicle) =>
      ["JH4DC4456YS013792", "19UUA66236A047635"].includes(vehicle.vin),
    ),
  ).toEqual([]);
  expect(result).toMatchObject({
    count: 409,
    observedVins: [
      "JH4DC4456YS013792",
      "5GAER23708J268506",
      "1GTS7AFXXC1121857",
      "2HKYF18427H509793",
    ],
    accounting: {
      recordsProcessed: 421,
      recordsRejected: 12,
      duplicateVehicles: 0,
    },
  });
}, 20_000);
async function withRepeatedPages(indices: number[]) {
  const document = await PDFDocument.load(await millerstownPdfFixture());
  // Identical copies of full pages sit before the last partial page.
  for (const copy of (await document.copyPages(document, indices)).reverse())
    document.insertPage(16, copy);
  return document.save({
    useObjectStreams: false,
    updateFieldAppearances: false,
  });
}
test("identical repeated rows are benign duplicates within the shared 25% limit", async () => {
  const { result, emitted } = await completes(await withRepeatedPages([1]));
  expect(emitted).toHaveLength(411);
  expect(result.accounting).toEqual({
    recordsProcessed: 447,
    recordsExcluded: 0,
    recordsRejected: 11,
    duplicateVehicles: 25,
  });
}, 20_000);
test("identical repeated rows beyond the shared 25% limit fail the source", async () => {
  const pdf = await withRepeatedPages([1, 2, 3, 4, 5, 6]);
  await failsWithoutCallbacks(
    (index, body) => (index === 2 ? pdf : body),
    "exceed the shared 25% duplicate limit",
    3,
  );
}, 20_000);
test("unchanged shared rejection cap rejects excessive required-field failures", async () => {
  // Blank the make on page 2 and the first nine rows of page 3: 43 of 421 rows
  // are then rejected while 378 complete donors still clear the floor.
  const pdf = await changedPdf((document) =>
    editContent(document, (source, page) =>
      page === 1 || page === 2
        ? source.replace(/BT[\s\S]*?\bET\b/g, (block) => {
            const y = / 271\.37 ([\d.]+) Tm/.exec(block)?.[1];
            return y !== undefined && (page === 1 || Number(y) > 390)
              ? ""
              : block;
          })
        : source,
    ),
  );
  await failsWithoutCallbacks(
    (index, body) => (index === 2 ? pdf : body),
    "378 complete and 43 rejected of 421 source rows; require 362 complete donors and retain the shared 10% rejection limit",
    3,
  );
}, 20_000);
test("a complete but undersized native catalog fails the 362 donor floor", async () => {
  const pdf = await changedPdf((document) => {
    for (let index = 15; index >= 4; index--) {
      const page = document.getPages()[index];
      if (!page) throw new Error("Missing page for minimized catalog");
      document.removePage(index);
      document.context.delete(page.ref);
    }
  });
  await failsWithoutCallbacks(
    (index, body) => (index === 2 ? pdf : body),
    "require 362 complete donors",
    3,
  );
}, 20_000);

for (const kind of ["yard", "batch"] as const)
  test(`${kind} callback failure returns no advanced checkpoint`, async () => {
    const requests = await replay();
    const start = { ...MillerstownCursor.initial };
    let batchCalls = 0;
    const result = await Effect.runPromiseExit(
      streamMillerstownInventoryWithRequestGate(
        {
          startCursor: start,
          onYards: () =>
            kind === "yard" ? Effect.fail("yard write failed") : Effect.void,
          onBatch: () => {
            batchCalls++;
            return Effect.fail("batch write failed");
          },
        },
        immediate,
      ),
    );
    expect(result._tag).toBe("Failure");
    expect(start).toEqual(MillerstownCursor.initial);
    expect(requests).toHaveLength(5);
    expect(batchCalls).toBe(kind === "yard" ? 0 : 1);
  }, 20_000);
test("callback consumption cannot change validated terminal count", async () => {
  await replay();
  const result = await Effect.runPromise(
    streamMillerstownInventoryWithRequestGate(
      {
        onBatch: (batch) =>
          Effect.sync(() => {
            batch.splice(0);
          }),
      },
      immediate,
    ),
  );
  expect(result.count).toBe(411);
  expect(result.accounting?.recordsProcessed).toBe(421);
}, 20_000);
test("invalid initial checkpoints and budgets perform no requests or callbacks", async () => {
  const requests = await replay();
  for (const startCursor of [
    null,
    { source: "pipes", phase: "start" },
    { ...MillerstownCursor.initial, offset: 1 },
  ])
    await expect(
      Effect.runPromise(
        streamMillerstownInventoryWithRequestGate(
          { startCursor, onBatch: () => Effect.die("Unexpected callback") },
          immediate,
        ),
      ),
    ).rejects.toThrow("Invalid cursor");
  for (const maxPages of [0, -1, 1.5, 33, Number.NaN])
    await expect(
      Effect.runPromise(
        streamMillerstownInventoryWithRequestGate(
          { maxPages, onBatch: () => Effect.die("Unexpected callback") },
          immediate,
        ),
      ),
    ).rejects.toThrow("catalog budget");
  expect(requests).toHaveLength(0);
});
test("read-only driver rejects a non-atomic budget without running the source", async () => {
  let calls = 0;
  await expect(
    soakMillerstownInventory(async () => {
      calls++;
      throw new Error("unexpected run");
    }, 2),
  ).rejects.toThrow("one atomic");
  expect(calls).toBe(0);
});
