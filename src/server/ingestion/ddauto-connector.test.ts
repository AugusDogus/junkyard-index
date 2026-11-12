import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamDdautoInventoryWithRequestGate } from "./ddauto-connector";
import { DdautoCursorSchema, type DdautoCursor } from "./ddauto-cursor";
import { DDAUTO_QUERY_BODY } from "./ddauto-parser";
import {
  ddautoTestOwner,
  ddautoTestPublished,
  ddautoTestPublishedUrl,
  ddautoTestRecord,
  ddautoTestRecords,
  ddautoTestRows,
  ddautoTestSnapshot,
  ddautoTestSnapshotWithColor,
} from "./ddauto-test-fixtures";
import type { DdautoCanonicalVehicle, DdautoRecord } from "./ddauto-transform";
import {
  DDAUTO_APP_ORIGIN,
  DDAUTO_OWNER_URL,
  DDAUTO_QUERY_URL,
} from "./ddauto-yard-metadata";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
type ResponseKind = "owner" | "snapshot" | "published" | "rows";
function mockInventory(
  options: {
    records?: readonly DdautoRecord[];
    rewrite?: (body: string, kind: ResponseKind, ordinal: number) => string;
    response?: (body: string, kind: ResponseKind) => Response;
  } = {},
) {
  const requests: ResponseKind[] = [];
  let snapshots = 0;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      let kind: ResponseKind;
      if (url === DDAUTO_OWNER_URL) kind = "owner";
      else if (
        url ===
        DDAUTO_APP_ORIGIN +
          "/api/container/playerFunctionCritical/getAppSnapshot"
      ) {
        kind = "snapshot";
        snapshots++;
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe('{"appID":"Ws6yVYonyVyaoiyrIvyP"}');
      } else if (url === ddautoTestPublishedUrl.split("#")[0]) {
        kind = "published";
        expect(new URL(url).hash).toBe("");
      } else if (url === DDAUTO_QUERY_URL) {
        kind = "rows";
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(DDAUTO_QUERY_BODY);
      } else throw new Error("Unexpected DD Auto request");
      requests.push(kind);
      const bodies = {
        owner: ddautoTestOwner,
        snapshot: ddautoTestSnapshot,
        published: ddautoTestPublished,
        rows: ddautoTestRows(options.records),
      };
      const body =
        options.rewrite?.(bodies[kind], kind, snapshots) ?? bodies[kind];
      return (
        options.response?.(body, kind) ??
        new Response(body, {
          headers: {
            "content-type":
              kind === "owner"
                ? "text/html; charset=UTF-8"
                : "application/json",
          },
        })
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}
const run = (
  onBatch = (_batch: DdautoCanonicalVehicle[]) => Effect.void,
  cursor?: DdautoCursor,
  maxPages = 1,
) =>
  Effect.runPromise(
    streamDdautoInventoryWithRequestGate(
      {
        onBatch,
        startCursor: cursor,
        maxPages,
      },
      gate,
    ),
  );

const validColorColumn = {
  name: "FYX7j",
  displayName: "Color",
  type: { kind: "string" },
  isUserSpecific: false,
  isProtected: false,
  fromNativeTable: true,
};
test.each([
  ["absent", null],
  ["relabelled", { ...validColorColumn, displayName: "Notes" }],
  ["renamed", { ...validColorColumn, name: "other" }],
  ["protected", { ...validColorColumn, isProtected: true }],
  ["user-specific", { ...validColorColumn, isUserSpecific: true }],
  ["wrong type", { ...validColorColumn, type: { kind: "number" } }],
  ["malformed", { name: "FYX7j" }],
  ["non-native", { ...validColorColumn, fromNativeTable: false }],
] as const)(
  "DD Auto nulls optional color from a stable %s binding without rejecting donors",
  async (_name, column) => {
    mockInventory({
      rewrite: (body, kind) =>
        kind === "snapshot" ? ddautoTestSnapshotWithColor(column) : body,
    });
    const vehicles: DdautoCanonicalVehicle[] = [];
    const result = await run((batch) =>
      Effect.sync(() => {
        vehicles.push(...batch);
      }),
    );
    expect(result.count).toBe(1);
    expect(result.accounting?.recordsRejected).toBe(0);
    expect(vehicles[0]?.color).toBeNull();
  },
);

test("DD Auto completes current native inventory after verifying owner, schema and status semantics", async () => {
  const records = [
    ddautoTestRecord,
    ...(["Premium Lot", "NOT AVAILABLE", "Killed"] as const).map(
      (status, i) => ({
        ...ddautoTestRecord,
        status,
        vin: "1N6AA06A04N00800" + i,
      }),
    ),
  ];
  const requests = mockInventory({ records });
  const vehicles: DdautoCanonicalVehicle[] = [];
  const yards: string[] = [];
  let gated = 0;
  const result = await Effect.runPromise(
    streamDdautoInventoryWithRequestGate(
      {
        onBatch: (batch) =>
          Effect.sync(() => {
            vehicles.push(...batch);
          }),
        onYards: (batch) =>
          Effect.sync(() => {
            yards.push(...batch.map((y) => y.code));
          }),
      },
      (request) =>
        Effect.sync(() => {
          gated++;
        }).pipe(Effect.zipRight(request)),
    ),
  );
  expect(requests).toEqual([
    "owner",
    "snapshot",
    "published",
    "rows",
    "snapshot",
  ]);
  expect(gated).toBe(5);
  expect(result).toMatchObject({
    status: "complete",
    count: 1,
    pagesProcessed: 1,
    cursor: { source: "ddauto", phase: "complete" },
    accounting: {
      recordsProcessed: 4,
      recordsExcluded: 3,
      recordsRejected: 0,
      duplicateVehicles: 0,
    },
  });
  expect(vehicles.map((v) => v.vin)).toEqual([ddautoTestRecord.vin]);
  expect(yards).toEqual(["logan"]);
  expect(
    DdautoCursorSchema.parse(JSON.parse(JSON.stringify(result.cursor))),
  ).toEqual(result.cursor);
});

test("DD Auto preserves valid rejected VINs and applies its unchanged 10% cap to active main-yard rows", async () => {
  const records = ddautoTestRecords(10).map((r, i) =>
    i === 9 ? { ...r, model: "Unknown" } : r,
  );
  mockInventory({ records });
  const result = await run();
  expect(result.count).toBe(9);
  expect(result.accounting?.recordsRejected).toBe(1);
  expect(result.observedVins).toEqual(["1N6AA06A04N008009"]);
  const excluded = ddautoTestRecords(50).map((r) => ({
    ...r,
    status: "NOT AVAILABLE" as const,
    vin: r.vin.replace("008", "009"),
  }));
  mockInventory({
    records: [
      ...records.slice(0, 4),
      records[9] ?? ddautoTestRecord,
      ...excluded,
    ],
  });
  let callbacks = 0;
  await expect(
    run(() =>
      Effect.sync(() => {
        callbacks++;
      }),
    ),
  ).rejects.toThrow("10% rejection limit");
  expect(callbacks).toBe(0);
});

test.each(["Parts", "Killed"] as const)(
  "DD Auto rejects active VIN conflicts with %s",
  async (status) => {
    mockInventory({
      records: [ddautoTestRecord, { ...ddautoTestRecord, status }],
    });
    await expect(run()).rejects.toThrow("repeat an active VIN/serial");
  },
);

test("DD Auto admits nullable optional color and excludes duplicate inactive listings", async () => {
  mockInventory({
    records: [
      { ...ddautoTestRecord, color: "Unknown" },
      ...Array.from({ length: 2 }, () => ({
        ...ddautoTestRecord,
        status: "NOT AVAILABLE" as const,
        vin: "1N6AA06A04N008001",
      })),
    ],
  });
  const vehicles: DdautoCanonicalVehicle[] = [];
  const result = await run((batch) =>
    Effect.sync(() => {
      vehicles.push(...batch);
    }),
  );
  expect(result.count).toBe(1);
  expect(result.accounting?.recordsExcluded).toBe(2);
  expect(vehicles[0]).toMatchObject({
    color: null,
    stockNumber: null,
    availableDate: null,
    imageUrl: null,
    row: null,
  });
});

test.each([
  [
    "missing source total",
    (body: string, kind: ResponseKind) =>
      kind === "rows" ? body.replace('"Total"', '"Other"') : body,
  ],
  [
    "changed physical owner",
    (body: string, kind: ResponseKind) =>
      kind === "owner" ? body.replace("1976 W 200 N", "1977 W 200 N") : body,
  ],
  [
    "changed status semantics",
    (body: string, kind: ResponseKind) =>
      kind === "published"
        ? body.replace(
            "IS AVAILABLE TO BUY PARTS FROM",
            "WILL BE AVAILABLE SOON",
          )
        : body,
  ],
  [
    "publication drift",
    (body: string, kind: ResponseKind, ordinal: number) =>
      kind === "snapshot" && ordinal === 2
        ? body.replace("1781021574647", "1781021574648")
        : body,
  ],
] as const)("DD Auto blocks %s before callbacks", async (_name, rewrite) => {
  mockInventory({ rewrite });
  let callbacks = 0;
  await expect(
    run(() =>
      Effect.sync(() => {
        callbacks++;
      }),
    ),
  ).rejects.toThrow("previous inventory is preserved");
  expect(callbacks).toBe(0);
});

const responseBoundaries: ResponseInit[] = [
  { status: 206, headers: { "content-type": "text/html" } },
  {
    status: 200,
    headers: { "content-type": "text/html", "content-range": "bytes 0-20/100" },
  },
  { status: 403, headers: { "content-type": "text/html" } },
  { status: 200, headers: { "content-type": "application/json" } },
  {
    status: 200,
    headers: { "content-type": "text/html", "content-length": "1" },
  },
];
test.each(responseBoundaries)(
  "DD Auto rejects invalid HTTP or body boundaries (%#)",
  async (init) => {
    mockInventory({ response: (body) => new Response(body, init) });
    await expect(run()).rejects.toThrow("previous inventory is preserved");
  },
);

test("DD Auto rejects redirected responses without retrying", async () => {
  const requests = mockInventory({
    response: (body) => {
      const response = new Response(body, {
        headers: { "content-type": "text/html" },
      });
      Object.defineProperty(response, "url", { value: "https://example.com/" });
      return response;
    },
  });
  await expect(run()).rejects.toThrow("verified endpoint");
  expect(requests).toEqual(["owner"]);
});

test("DD Auto callback failures cannot return an advanced checkpoint", async () => {
  mockInventory();
  await expect(
    Effect.runPromise(
      streamDdautoInventoryWithRequestGate(
        {
          onBatch: () => Effect.fail(new Error("staging failed")),
        },
        gate,
      ),
    ),
  ).rejects.toThrow("staging failed");
});

test("DD Auto validates budgets and treats complete cursors idempotently", async () => {
  const requests = mockInventory();
  await expect(run(undefined, undefined, 0)).rejects.toThrow("catalog budget");
  expect(
    DdautoCursorSchema.safeParse({ source: "ddauto", phase: "page", page: 1 })
      .success,
  ).toBe(false);
  expect(
    (await run(undefined, { source: "ddauto", phase: "complete" }))
      .pagesProcessed,
  ).toBe(0);
  expect(requests).toEqual([]);
});
