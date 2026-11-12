import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { createHash } from "node:crypto";
import { soakPickersInventory } from "../../../scripts/soak-pickers";
import { connectorChunkMetrics } from "./connector-chunk";
import {
  streamPickersInventoryWithRequestGate,
  type PickersStreamResult,
} from "./pickers-connector";
import { PICKERS_MAX_CURSOR_BYTES, PickersCursor } from "./pickers-cursor";
import {
  pickersSavedFixture,
  pickersTestConfig,
  pickersTestInventory,
  pickersTestOwner,
  pickersTestRecord,
  pickersTestSearch,
} from "./pickers-test-fixtures";
import { pickersHash } from "./pickers-parser";
import { fetchPickersInventory } from "./pickers-client";
import type { VinplusRecord } from "./vinplus-protocol";
import type { PickersCanonicalVehicle } from "./pickers-transform";
import {
  PICKERS_APP_URL,
  PICKERS_CONFIG_URL,
  PICKERS_INVENTORY_URL,
  PICKERS_ORIGIN,
  PICKERS_SEARCH_URL,
  PICKERS_YARD,
} from "./pickers-yard-metadata";

const fixture = pickersSavedFixture();
const identityGate = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect;
afterEach(() => {
  spyOn(globalThis, "fetch").mockRestore();
});

function transport(
  change?: (
    raw: string,
    request: { url: string; init?: RequestInit },
  ) => string,
  data = fixture,
) {
  const makes = new Map(data.native.map((item) => [item.make, item]));
  const pairs = new Map(
    data.queries.map((item) => [
      JSON.stringify([item.pair.make, item.pair.model]),
      item.body,
    ]),
  );
  const nativeHits = new Map<string, number>();
  const queries = new Map<string, number>();
  const calls: { url: string; init?: RequestInit }[] = [];
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        expect(init?.redirect).toBe("manual");
        let raw: string | undefined;
        let mime = "text/html";
        if (url === PICKERS_ORIGIN + "/") raw = data.owner;
        else if (url === PICKERS_APP_URL) raw = data.app;
        else if (url === PICKERS_CONFIG_URL) {
          raw = data.config;
          mime = "application/json";
        } else if (url === PICKERS_INVENTORY_URL) {
          if (init?.method === "POST") {
            if (typeof init.body !== "string")
              throw new Error("Native form body must be literal");
            const form = new URLSearchParams(init.body);
            expect(form.get("VehicleModel")).toBe("");
            const make = form.get("VehicleMake") ?? "";
            const count = nativeHits.get(make) ?? 0;
            nativeHits.set(make, count + 1);
            raw =
              count === 0 ? makes.get(make)?.opening : makes.get(make)?.closing;
          } else raw = data.inventory;
        } else if (url === PICKERS_SEARCH_URL) {
          mime = "application/json";
          if (typeof init?.body !== "string")
            throw new Error("Public payload must be JSON");
          const payload: unknown = JSON.parse(init.body);
          const query = data.queries.find(
            (item) =>
              init.body ===
              JSON.stringify({
                yard_id: "tri_state_iron_metal",
                year_min: null,
                year_max: null,
                ...item.pair,
                language: "en",
                location_id: "pickers_texarkana",
              }),
          );
          if (!query)
            throw new Error(
              "Unexpected or sibling public payload " + JSON.stringify(payload),
            );
          const key = JSON.stringify([query.pair.make, query.pair.model]);
          const count = queries.get(key) ?? 0;
          queries.set(key, count + 1);
          raw =
            count && query === data.queries[0]
              ? data.firstBookend
              : count && query === data.queries.at(-1)
                ? data.lastBookend
                : pairs.get(key);
        }
        if (raw === undefined) throw new Error("No saved response for " + url);
        const body = change ? change(raw, { url, init }) : raw;
        return new Response(body, {
          status: 200,
          headers: {
            "content-type": mime,
            "content-length": String(Buffer.byteLength(body)),
          },
        });
      },
      { preconnect: () => {} },
    ),
  );
  return { calls, queries };
}

async function run(
  budget: number,
  stop?: (result: PickersStreamResult) => boolean,
) {
  let cursor: PickersCursor = PickersCursor.initial;
  const chunks: PickersStreamResult[] = [];
  const batches: PickersCanonicalVehicle[][] = [];
  const checkpoints: {
    phase: PickersCursor["phase"];
    bytes: number;
    requests: number;
    responseBytes: number;
  }[] = [];
  let yards = 0,
    maxCursorBytes = 0;
  for (let chunk = 0; chunk < 300; chunk++) {
    const requestedCursor = cursor;
    const result = await Effect.runPromise(
      streamPickersInventoryWithRequestGate(
        {
          startCursor: cursor,
          maxPages: budget,
          onBatch: (vehicles) =>
            Effect.sync(() => {
              batches.push(vehicles);
            }),
          onYards: () =>
            Effect.sync(() => {
              yards++;
            }),
        },
        identityGate,
      ),
    );
    chunks.push(result);
    const serialized = PickersCursor.serialize(result.cursor);
    maxCursorBytes = Math.max(maxCursorBytes, Buffer.byteLength(serialized));
    checkpoints.push({
      phase: result.cursor.phase,
      bytes: Buffer.byteLength(serialized),
      requests:
        result.cursor.phase === "start" ? 0 : result.cursor.state.requests,
      responseBytes:
        result.cursor.phase === "start" ? 0 : result.cursor.state.bytes,
    });
    cursor = PickersCursor.parse(serialized);
    if (result.status === "paused") {
      expect(result.count).toBe(0);
      expect(result.observedVins).toEqual([]);
      expect(result.accounting).toEqual({
        recordsProcessed: 0,
        recordsRejected: 0,
        recordsExcluded: 0,
        duplicateVehicles: 0,
      });
      expect(batches.length).toBe(0);
      expect(yards).toBe(0);
    }
    if (result.status === "complete" || stop?.(result))
      return {
        chunks,
        batches,
        yards,
        maxCursorBytes,
        cursor,
        checkpoints,
        requestedCursor,
      };
  }
  throw new Error("Replay exceeded finite chunk bound");
}

describe("Pickers frozen corpus through actual connector and cursor", () => {
  for (const budget of [4, 7, 16])
    test("terminal-only donor accounting, budget " + budget, async () => {
      const mock = transport();
      const result = await run(budget);
      expect(result.cursor.phase).toBe("complete");
      expect(result.batches.length).toBe(1);
      expect(result.batches[0]?.length).toBe(540);
      expect(result.yards).toBe(1);
      const totals = result.chunks
        .map((chunk) => connectorChunkMetrics(chunk, chunk.count))
        .reduce(
          (sum, metrics) => ({
            vehiclesProcessed:
              sum.vehiclesProcessed + metrics.vehiclesProcessed,
            uniqueVehicles: sum.uniqueVehicles + metrics.uniqueVehicles,
            duplicateVehicles:
              sum.duplicateVehicles + metrics.duplicateVehicles,
            rejectedVehicles: sum.rejectedVehicles + metrics.rejectedVehicles,
          }),
          {
            vehiclesProcessed: 0,
            uniqueVehicles: 0,
            duplicateVehicles: 0,
            rejectedVehicles: 0,
          },
        );
      expect(totals).toEqual({
        vehiclesProcessed: 567,
        uniqueVehicles: 540,
        duplicateVehicles: 0,
        rejectedVehicles: 27,
      });
      expect(result.chunks.at(-1)?.observedVins?.length).toBe(11);
      expect(
        result.chunks.reduce((sum, chunk) => sum + chunk.pagesProcessed, 0),
      ).toBe(267);
      expect(result.maxCursorBytes).toBeLessThanOrEqual(
        PICKERS_MAX_CURSOR_BYTES,
      );
      if (result.cursor.phase !== "complete")
        throw new Error("Missing terminal proof");
      expect(result.cursor.state.requests).toBe(mock.calls.length);
      expect(result.cursor.state.rawSelectorOccurrences).toBe(659);
      expect(result.cursor.state.queryOverlapOccurrences).toBe(92);
      expect(mock.queries.size).toBe(197);
      expect(result.cursor.proof.processed).toBe(567);
      const output = process.env.PICKERS_REPLAY_EVIDENCE_DIR;
      if (output) {
        const files: Record<string, { bytes: number; sha256: string }> = {};
        for (const [name, value] of Object.entries({
          canonical: result.batches.flat(),
          presence: result.chunks.at(-1)?.observedVins,
          yard: PICKERS_YARD,
          cursor: JSON.parse(PickersCursor.serialize(result.cursor)),
          requested: JSON.parse(
            PickersCursor.serialize(result.requestedCursor),
          ),
          terminal: result.chunks.at(-1),
        })) {
          const content =
            (name === "cursor"
              ? PickersCursor.serialize(result.cursor)
              : name === "requested"
                ? PickersCursor.serialize(result.requestedCursor)
                : name === "terminal"
                  ? JSON.stringify(value)
                  : JSON.stringify(value, null, 2)) + "\n";
          const path = "budget-" + budget + "-" + name + ".json";
          await Bun.write(output + "/" + path, content);
          files[path] = {
            bytes: Buffer.byteLength(content),
            sha256: createHash("sha256").update(content).digest("hex"),
          };
        }
        const report = {
          budget,
          liveHttp: 0,
          files,
          chunks: result.chunks.length,
          dataControls: result.chunks.reduce(
            (sum, chunk) => sum + chunk.pagesProcessed,
            0,
          ),
          checkpoints: result.checkpoints,
          maxCursorBytes: result.maxCursorBytes,
          terminalCursorBytes: Buffer.byteLength(
            PickersCursor.serialize(result.cursor),
          ),
          requests: mock.calls.length,
          totals,
          excluded: result.chunks.reduce(
            (sum, chunk) => sum + (chunk.accounting?.recordsExcluded ?? 0),
            0,
          ),
          callbacks: { batches: result.batches.length, yards: result.yards },
          presence: result.chunks.at(-1)?.observedVins?.length,
          chunksProjection: result.chunks.map((chunk) => ({
            phase: chunk.cursor.phase,
            count: chunk.count,
            pagesProcessed: chunk.pagesProcessed,
            accounting: chunk.accounting,
            presence: chunk.observedVins?.length,
          })),
        };
        await Bun.write(
          output + "/budget-" + budget + "-report.json",
          JSON.stringify(report, null, 2) + "\n",
        );
      }
    }, 120_000);
});

function smallFixture(count = 40) {
  const good = Array.from({ length: count }, (_, index) => ({
    ...pickersTestRecord,
    stock: "STK" + String(100000 + index),
    vin: "1FADP3E23EL" + String(100000 + index),
  }));
  const invalid = { ...pickersTestRecord, stock: "STK200000", vin: "invalid" };
  const missing = {
    ...pickersTestRecord,
    stock: "STK200001",
    vin: "1FADP3E23EL200001",
  };
  const metadata = {
    ...pickersTestRecord,
    stock: "STK200002",
    vin: "1FADP3E23EL200002",
  };
  const quarantined = {
    ...pickersTestRecord,
    stock: "STK200003",
    vin: "1FADP3E23EL200003",
  };
  const native: VinplusRecord[] = [
    ...good,
    invalid,
    missing,
    { ...metadata, model: "" },
  ];
  const api = [...good, invalid, metadata, quarantined];
  const opening = pickersTestInventory(native, ["FORD"]);
  const body = pickersTestSearch(api);
  return {
    ...fixture,
    owner: pickersTestOwner,
    config: pickersTestConfig,
    inventory: pickersTestInventory([], ["FORD"]),
    native: [{ make: "FORD", opening, closing: opening }],
    queries: [{ pair: { make: "FORD", model: "FOCUS" }, body }],
    firstBookend: body,
    lastBookend: body,
  };
}

test("missing enrichment is a counted reject and valid metadata failures retain presence", async () => {
  transport(undefined, smallFixture());
  const result = await run(16);
  expect(result.batches.flat()).toHaveLength(40);
  expect(result.chunks.at(-1)?.accounting).toEqual({
    recordsProcessed: 44,
    recordsRejected: 4,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  });
  expect(result.chunks.at(-1)?.observedVins).toEqual([
    "1FADP3E23EL200002",
    "1FADP3E23EL200003",
  ]);
  if (result.cursor.phase !== "complete")
    throw new Error("Expected complete proof");
  expect(result.cursor.state.missing.map((entry) => entry.stock)).toEqual([
    "STK200001",
  ]);
});

test("cursor binds whole raw optionals, disposition, receipts, counters and terminal proof", async () => {
  transport(undefined, smallFixture());
  const result = await run(16);
  if (result.cursor.phase !== "complete")
    throw new Error("Expected complete proof");
  const original = result.cursor;
  const changes: ((cursor: typeof original) => void)[] = [
    (cursor) => {
      const entry = cursor.state.entries[0];
      if (!entry) throw new Error("Missing entry");
      entry.record.fields.daysInYard = ["literal", 987];
    },
    (cursor) => {
      const entry = cursor.state.entries[0];
      if (!entry) throw new Error("Missing entry");
      entry.nativeHash = "0".repeat(64);
    },
    (cursor) => {
      const entry = cursor.state.entries[0];
      if (!entry || entry.disposition.status !== "available")
        throw new Error("Missing available entry");
      entry.disposition.canonicalHash = "0".repeat(64);
    },
    (cursor) => {
      cursor.state.receipts.splice(1, 1);
    },
    (cursor) => {
      cursor.state.receipts.reverse();
    },
    (cursor) => {
      cursor.state.receipts.push(
        cursor.state.receipts[0] ??
          (() => {
            throw new Error("Missing receipt");
          })(),
      );
    },
    (cursor) => {
      cursor.state.requests--;
    },
    (cursor) => {
      cursor.state.queryOverlapOccurrences++;
    },
    (cursor) => {
      cursor.proof.presenceHash = "0".repeat(64);
    },
    (cursor) => {
      const row = cursor.state.native[0];
      if (!row) throw new Error("Missing native row");
      row.reference = ["literal", "changed"];
    },
  ];
  for (const change of changes) {
    const cursor = structuredClone(original);
    change(cursor);
    // Recomputing the outer hash must not bypass inner receipt/entry proof.
    cursor.progressHash = pickersHash({
      source: cursor.source,
      version: cursor.version,
      phase: cursor.phase,
      state: cursor.state,
      proof: cursor.proof,
    });
    expect(() => PickersCursor.serialize(cursor)).toThrow();
  }
  expect(() =>
    PickersCursor.parse(
      JSON.stringify({ source: "joliet", version: 1, phase: "start" }),
    ),
  ).toThrow();
  expect(PickersCursor.serialize(PickersCursor.initial)).toBe(
    '{"version":1,"phase":"start"}',
  );
  const wire = PickersCursor.serialize(original);
  expect(
    PickersCursor.parse(
      " ".repeat(PICKERS_MAX_CURSOR_BYTES - Buffer.byteLength(wire)) + wire,
    ),
  ).toEqual(original);
  expect(() =>
    PickersCursor.parse(" ".repeat(PICKERS_MAX_CURSOR_BYTES + 1)),
  ).toThrow("exceeds 1 MiB");
  expect(() =>
    PickersCursor.parse(
      JSON.stringify({ value: "é".repeat(PICKERS_MAX_CURSOR_BYTES / 2) }),
    ),
  ).toThrow("exceeds 1 MiB");
});

test("closing drift, exact-query drift and callback failure return no advanced checkpoint", async () => {
  const data = smallFixture();
  transport(undefined, data);
  const opening = await run(
    16,
    (chunk) => chunk.cursor.phase === "native-closing",
  );
  spyOn(globalThis, "fetch").mockRestore();
  const bad = {
    ...data,
    native: data.native.map((item) => ({
      ...item,
      closing: item.closing.replace("L4, 2.0L", "L4, 3.0L"),
      opening: item.opening.replace("L4, 2.0L", "L4, 3.0L"),
    })),
  };
  transport(undefined, bad);
  let callbacks = 0;
  const options = {
    startCursor: opening.cursor,
    maxPages: 16,
    onBatch: () =>
      Effect.sync(() => {
        callbacks++;
      }),
  };
  await expect(
    Effect.runPromise(
      streamPickersInventoryWithRequestGate(options, identityGate),
    ),
  ).rejects.toThrow("Closing native inventory changed");
  expect(callbacks).toBe(0);
  spyOn(globalThis, "fetch").mockRestore();
  transport(
    (raw, request) =>
      request.url === PICKERS_INVENTORY_URL && request.init?.method === "POST"
        ? raw.replace(
            '<img src="../PickersInventoryPhotos/STK100000.jpg">',
            '<img src="../PickersInventoryPhotos/STK100000.jpg?changed=1">',
          )
        : raw,
    data,
  );
  await expect(
    Effect.runPromise(
      streamPickersInventoryWithRequestGate(options, identityGate),
    ),
  ).rejects.toThrow("Closing native inventory changed");
  expect(callbacks).toBe(0);
  spyOn(globalThis, "fetch").mockRestore();
  transport(undefined, data);
  const closing = await Effect.runPromise(
    streamPickersInventoryWithRequestGate(options, identityGate),
  );
  spyOn(globalThis, "fetch").mockRestore();
  transport(
    (raw, request) =>
      request.url === PICKERS_SEARCH_URL
        ? raw.replace('"color":"BLACK"', '"color":"BLUE"')
        : raw,
    data,
  );
  await expect(
    Effect.runPromise(
      streamPickersInventoryWithRequestGate(
        { ...options, startCursor: closing.cursor },
        identityGate,
      ),
    ),
  ).rejects.toThrow("Repeated stock changed");
  expect(callbacks).toBe(0);
  spyOn(globalThis, "fetch").mockRestore();
  transport(undefined, data);
  await expect(
    Effect.runPromise(
      streamPickersInventoryWithRequestGate(
        {
          ...options,
          startCursor: closing.cursor,
          onBatch: () => Effect.fail(new Error("staging unavailable")),
        },
        identityGate,
      ),
    ),
  ).rejects.toThrow("staging unavailable");
  expect(closing.cursor.phase).toBe("bookends");
});

test("wrong year and wrong site fail before canonical callbacks", async () => {
  for (const replacement of [
    ['"year":2014', '"year":2013'],
    [
      '"yardLocation":"Pickers Texarkana"',
      '"yardLocation":"Tri-State Longview"',
    ],
  ]) {
    const [from, to] = replacement;
    if (!from || !to) throw new Error("Missing probe replacement");
    transport(
      (raw, request) =>
        request.url === PICKERS_SEARCH_URL ? raw.replace(from, to) : raw,
      smallFixture(),
    );
    await expect(run(16)).rejects.toThrow();
    spyOn(globalThis, "fetch").mockRestore();
  }
});

test("optional growth exceeding the output cursor cap preserves the last checkpoint", async () => {
  const data = smallFixture(500);
  transport(
    (raw, request) =>
      request.url === PICKERS_SEARCH_URL
        ? raw.replaceAll(
            '"engine":null',
            '"engine":' + JSON.stringify("x".repeat(2048)),
          )
        : raw,
    data,
  );
  const opening = await run(16, (chunk) => chunk.cursor.phase === "queries");
  let callbacks = 0;
  await expect(
    Effect.runPromise(
      streamPickersInventoryWithRequestGate(
        {
          startCursor: opening.cursor,
          maxPages: 16,
          onBatch: () =>
            Effect.sync(() => {
              callbacks++;
            }),
        },
        identityGate,
      ),
    ),
  ).rejects.toThrow("exceeds 1 MiB");
  expect(callbacks).toBe(0);
  expect(opening.cursor.phase).toBe("queries");
});

test("tiny data budgets count resume guards and fail at the fixed HTTP ceiling", async () => {
  const records = Array.from({ length: 200 }, (_, index) => ({
    ...pickersTestRecord,
    stock: "STK" + String(100000 + index),
    vin: "1FADP3E23EL" + String(100000 + index),
    model: "MODEL" + String(index).padStart(3, "0"),
  }));
  const native = pickersTestInventory(records, ["FORD"]);
  const queries = records.map((record) => ({
    pair: { make: record.make, model: record.model },
    body: pickersTestSearch([record], {
      make: record.make,
      model: record.model,
    }),
  }));
  const first = queries[0],
    last = queries.at(-1);
  if (!first || !last) throw new Error("Missing finite selector endpoints");
  const mock = transport(undefined, {
    ...smallFixture(),
    native: [{ make: "FORD", opening: native, closing: native }],
    queries,
    firstBookend: first.body,
    lastBookend: last.body,
  });
  await expect(run(1)).rejects.toThrow("512 HTTP requests");
  expect(mock.calls).toHaveLength(512);
}, 120_000);

test("transport stops on redirects, denied responses, MIME, range, length and UTF-8 failures without retry", async () => {
  const probes = [
    () =>
      new Response("redirect", {
        status: 302,
        headers: { location: "https://example.invalid/" },
      }),
    () => new Response("denied", { status: 403 }),
    () => new Response("busy", { status: 429 }),
    () => new Response("down", { status: 503 }),
    () =>
      new Response(fixture.inventory, {
        headers: { "content-type": "application/json" },
      }),
    () =>
      new Response(fixture.inventory, {
        headers: {
          "content-type": "text/html",
          "content-range": "bytes 0-99/200",
        },
      }),
    () =>
      new Response(fixture.inventory, {
        headers: { "content-type": "text/html", "content-length": "1" },
      }),
    () =>
      new Response(new Uint8Array([255]), {
        headers: { "content-type": "text/html" },
      }),
    () => {
      const response = new Response(fixture.inventory, {
        headers: { "content-type": "text/html" },
      });
      Object.defineProperty(response, "url", {
        value: "https://example.invalid/",
      });
      return response;
    },
  ];
  for (const probe of probes) {
    let calls = 0;
    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          calls++;
          expect(init?.redirect).toBe("manual");
          return probe();
        },
        { preconnect: () => {} },
      ),
    );
    await expect(
      Effect.runPromise(fetchPickersInventory(identityGate)),
    ).rejects.toThrow("prior inventory is preserved");
    expect(calls).toBe(1);
    spyOn(globalThis, "fetch").mockRestore();
  }
});

test("a complete empty selector records missing enrichment and reused valid VINs fail closed", async () => {
  const data = smallFixture(50);
  const extra = {
    ...pickersTestRecord,
    stock: "STK299999",
    model: "GHOST",
    vin: "1FADP3E23EL299999",
  };
  data.native = data.native.map((item) => ({
    ...item,
    opening: item.opening.replace(
      "</tr></table>",
      '</tr><tr><td>2014</td><td>FORD</td><td>GHOST</td><td></td><td></td><td></td><td></td><td><a href="../PickersInventoryPhotos/STK299999.jpg">photo</a></td></tr></table>',
    ),
    closing: item.closing.replace(
      "</tr></table>",
      '</tr><tr><td>2014</td><td>FORD</td><td>GHOST</td><td></td><td></td><td></td><td></td><td><a href="../PickersInventoryPhotos/STK299999.jpg">photo</a></td></tr></table>',
    ),
  }));
  const empty = {
    pair: { make: extra.make, model: extra.model },
    body: pickersTestSearch([], { make: extra.make, model: extra.model }),
  };
  data.queries.push(empty);
  data.lastBookend = empty.body;
  transport(undefined, data);
  const result = await run(16);
  if (result.cursor.phase !== "complete")
    throw new Error("Expected empty-selector terminal proof");
  expect(result.cursor.state.missing.map((entry) => entry.stock)).toEqual([
    "STK200001",
    extra.stock,
  ]);
  expect(
    result.cursor.state.receipts.find(
      (receipt) => receipt.kind === "query" && receipt.index === 1,
    )?.members,
  ).toEqual([]);
  spyOn(globalThis, "fetch").mockRestore();
  transport(
    (raw, request) =>
      request.url === PICKERS_SEARCH_URL
        ? raw.replace('"vin":"1FADP3E23EL100001"', '"vin":"1FADP3E23EL100000"')
        : raw,
    smallFixture(),
  );
  await expect(run(16)).rejects.toThrow(
    "Distinct stocks reuse one valid identity",
  );
});

test("read-only soak roundtrips terminal-only chunks and rejects a bad donor ratio", async () => {
  transport(undefined, smallFixture());
  let vehicles = 0;
  const result = await soakPickersInventory((cursor, maxPages) =>
    Effect.runPromise(
      streamPickersInventoryWithRequestGate(
        {
          startCursor: cursor,
          maxPages,
          onBatch: (batch) =>
            Effect.sync(() => {
              vehicles += batch.length;
            }),
        },
        identityGate,
      ),
    ),
  );
  expect(result.status).toBe("complete");
  expect(result.pagesProcessed).toBe(5);
  expect(result.count).toBe(40);
  expect(vehicles).toBe(40);
  spyOn(globalThis, "fetch").mockRestore();
  transport(undefined, smallFixture(1));
  await expect(run(16)).rejects.toThrow("rejection limit");
});

test("callbacks can consume their inputs without changing terminal accounting or shared yard metadata", async () => {
  transport(undefined, smallFixture());
  const opening = await run(16, (chunk) => chunk.cursor.phase === "bookends");
  const result = await Effect.runPromise(
    streamPickersInventoryWithRequestGate(
      {
        startCursor: opening.cursor,
        maxPages: 16,
        onBatch: (vehicles) =>
          Effect.sync(() => {
            const first = vehicles[0];
            if (first) first.model = "consumer edit";
            vehicles.splice(0);
          }),
        onYards: (yards) =>
          Effect.sync(() => {
            Object.assign(yards[0] ?? {}, {
              city: "consumer edit",
              lat: 0,
              lng: 0,
            });
          }),
      },
      identityGate,
    ),
  );
  expect(result.count).toBe(40);
  expect(result.accounting).toEqual({
    recordsProcessed: 44,
    recordsRejected: 4,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  });
  expect(PICKERS_YARD.city).toBe("Texarkana");
  expect(PICKERS_YARD.lat).toBe(33.42952);
  expect(() => PickersCursor.serialize(result.cursor)).not.toThrow();
});
