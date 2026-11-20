import { afterEach, expect, test } from "bun:test";
import {
  isDurableSourceCursorTerminal,
  serializeDurableSourceCursor,
} from "./durable-source";
import { Effect } from "effect";
import { streamRohnerInventoryWithRequestGate } from "./rohner-connector";
import {
  ROHNER_MAX_CURSOR_BYTES,
  RohnerCursor,
  RohnerCursorSchema,
} from "./rohner-cursor";
import {
  rohnerDeliveryCatalog,
  rohnerDeliveryDonors,
} from "./rohner-delivery-test-fixtures";
import type { RohnerCanonicalVehicle } from "./rohner-transform";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
function mockInventory(
  options: { drift?: boolean; rejects?: number; conflict?: boolean } = {},
) {
  const requests: { url: string; redirect: RequestRedirect | undefined }[] = [];
  const reads = new Map<number, number>();
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push({ url: url.href, redirect: init?.redirect });
      const donor = rohnerDeliveryDonors.find(
        (value) => value.url === url.href,
      );
      let body: string;
      if (donor) {
        body = donor.html;
        const index = rohnerDeliveryDonors.indexOf(donor);
        if (index >= rohnerDeliveryDonors.length - (options.rejects ?? 0))
          body = body.replaceAll("Make: Mitsubishi", "Make: Ford");
        if (options.conflict && index === 8)
          body = body.replaceAll("ML32A4HJ3FH100001", "ML32A4HJ3FH100000");
      } else {
        const page = Number(/\/page\/(\d+)\//.exec(url.pathname)?.[1] ?? "1");
        const count = (reads.get(page) ?? 0) + 1;
        reads.set(page, count);
        body = rohnerDeliveryCatalog(page);
        if (options.drift && page === 2 && count > 1)
          body = body.replaceAll("Mitsubishi Mirage", "Mitsubishi Lancer");
      }
      return new Response(body, {
        headers: { "content-type": "text/html; charset=UTF-8" },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}
const run = (
  cursor: RohnerCursor = RohnerCursor.initial,
  maxPages = 3,
  onBatch: (
    vehicles: RohnerCanonicalVehicle[],
  ) => Effect.Effect<void, Error> = () => Effect.void,
) =>
  Effect.runPromise(
    streamRohnerInventoryWithRequestGate(
      { startCursor: cursor, maxPages, onBatch },
      gate,
    ),
  );

async function complete(
  onBatch: (
    vehicles: RohnerCanonicalVehicle[],
  ) => Effect.Effect<void, Error> = () => Effect.void,
) {
  let cursor = RohnerCursor.initial;
  for (let chunk = 0; chunk < 40; chunk++) {
    const result = await run(cursor, 3, onBatch);
    if (result.status === "complete") return result;
    expect(result.count).toBe(0);
    expect(result.observedVins).toEqual([]);
    expect(result.accounting.recordsProcessed).toBe(0);
    cursor = RohnerCursor.parse(RohnerCursor.serialize(result.cursor));
  }
  throw new Error("Rohner scenario did not reach a complete checkpoint");
}

test("Rohner resumes all opening, donor and closing controls before emitting once", async () => {
  const requests = mockInventory();
  const batches: RohnerCanonicalVehicle[][] = [];
  const result = await complete((vehicles) =>
    Effect.sync(() => {
      batches.push(vehicles);
    }),
  );
  expect({
    status: result.status,
    count: result.count,
    accounting: result.accounting,
  }).toEqual({
    status: "complete",
    count: 24,
    accounting: {
      recordsProcessed: 25,
      recordsExcluded: 1,
      recordsRejected: 0,
      duplicateVehicles: 0,
    },
  });
  expect(batches).toHaveLength(1);
  expect(batches[0]).toHaveLength(24);
  expect(result.observedVins).not.toContain("RA29076797");
  expect(requests).toHaveLength(29);
  expect(requests.every((request) => request.redirect === "manual")).toBe(true);
  expect(result.cursor).toMatchObject({ phase: "complete" });
  expect(
    isDurableSourceCursorTerminal(
      "rohner",
      serializeDurableSourceCursor(result.cursor),
    ),
  ).toBe(true);
  expect(result.cursor.records).toHaveLength(25);
  expect(result.cursor.closing).toHaveLength(2);
  expect(Buffer.byteLength(RohnerCursor.serialize(result.cursor))).toBeLessThan(
    ROHNER_MAX_CURSOR_BYTES,
  );
  expect(
    await run(
      RohnerCursor.parse(RohnerCursor.serialize(result.cursor)),
      3,
      () => Effect.die("Terminal replay emitted"),
    ),
  ).toMatchObject({ status: "complete", count: 0, pagesProcessed: 0 });
  expect(requests).toHaveLength(29);
});

test("Rohner rejects middle-page membership drift and excessive required rejects before callbacks", async () => {
  for (const options of [{ drift: true }, { rejects: 3 }]) {
    mockInventory(options);
    await expect(
      complete(() => Effect.die("Unvalidated emission")),
    ).rejects.toThrow(
      options.drift ? "closing listing membership" : "10% rejection",
    );
  }
});

test("Rohner quarantines every conflicting VIN claim while preserving rejected presence", async () => {
  mockInventory({ conflict: true });
  const result = await complete();
  expect(result.count).toBe(22);
  expect(result.accounting.recordsRejected).toBe(2);
  expect(result.accounting.recordsExcluded).toBe(1);
  expect(result.observedVins).toContain("ML32A4HJ3FH100000");
});

test("Rohner callback failure leaves the supplied closing checkpoint unchanged", async () => {
  mockInventory();
  let cursor = RohnerCursor.initial;
  while (cursor.phase !== "closing" || cursor.closing.length !== 1)
    cursor = (await run(cursor, 1)).cursor;
  const before = RohnerCursor.serialize(cursor);
  await expect(
    run(cursor, 1, () => Effect.fail(new Error("Batch unavailable"))),
  ).rejects.toThrow("Batch unavailable");
  expect(RohnerCursor.serialize(cursor)).toBe(before);
});

test("Rohner validates cursor integrity, complete ancestry and budgets before requests", async () => {
  const requests = mockInventory();
  const partial = await run(undefined, 2);
  const wire = RohnerCursor.serialize(partial.cursor);
  expect(() =>
    RohnerCursor.parse(wire.replace("Mitsubishi", "Toyota")),
  ).toThrow();
  expect(() =>
    RohnerCursor.parse(" ".repeat(ROHNER_MAX_CURSOR_BYTES + 1)),
  ).toThrow("exceeds 16 MiB");
  expect(
    RohnerCursorSchema.safeParse({
      source: "rohner",
      version: 1,
      phase: "complete",
    }).success,
  ).toBe(false);
  expect(() =>
    RohnerCursor.checkpoint({ ...partial.cursor, phase: "complete" }),
  ).toThrow("control prefix");
  expect(() =>
    RohnerCursor.checkpoint({
      ...partial.cursor,
      pages: [...partial.cursor.pages].reverse(),
    }),
  ).toThrow("listing prefix");
  const detail = await run(partial.cursor, 1);
  expect(() =>
    RohnerCursor.checkpoint({
      ...detail.cursor,
      records: detail.cursor.records.map((record) =>
        record.status === "required-pass"
          ? { ...record, candidate: { ...record.candidate, make: "Ford" } }
          : record,
      ),
    }),
  ).toThrow();
  const count = requests.length;
  await expect(run(partial.cursor, 0)).rejects.toThrow("request-unit budget");
  await expect(run(partial.cursor, 4)).rejects.toThrow("request-unit budget");
  expect(requests).toHaveLength(count);
});
