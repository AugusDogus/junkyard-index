import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { RtpRecordSchema, type RtpRecord, type RtpYard } from "./rtp-client";
import { streamRtpInventoryWithRequestGate } from "./rtp-connector";
import { RtpCursor, RtpCursorSchema, RtpYardCodeSchema } from "./rtp-cursor";
import { RTP_YARDS } from "./rtp-yard-metadata";
import { rtpTestContext, rtpTestRecord } from "./rtp-test-fixtures";
import type { RtpCanonicalVehicle } from "./rtp-transform";

const originalFetch = globalThis.fetch;
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
interface Page {
  draw: string;
  recordsTotal: number;
  recordsFiltered: number;
  data: RtpRecord[];
}
function mockInventory(
  options: {
    total?: number;
    record?: (record: RtpRecord, index: number) => RtpRecord;
    page?: (page: Page, params: URLSearchParams) => Response;
    context?: (html: string) => string;
  } = {},
) {
  const requests: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push(url.href);
      if (url.pathname.endsWith("/inventory/")) {
        const code = RtpYardCodeSchema.options.find(
          (code) => url.href === `${RTP_YARDS[code].home}inventory/`,
        );
        if (!code) throw new Error("Unqualified RTP yard requested");
        return new Response(
          options.context?.(rtpTestContext(code)) ?? rtpTestContext(code),
        );
      }
      if (
        url.pathname !== "/wp-admin/admin-ajax.php" ||
        typeof init?.body !== "string"
      )
        throw new Error("Unexpected RTP test request");
      const params = new URLSearchParams(init.body);
      const parsedCode = RtpYardCodeSchema.safeParse(
        params.get("params[yard_id]"),
      );
      if (!parsedCode.success)
        throw new Error("Unqualified RTP yard requested");
      const code = parsedCode.data;
      expect(params.get("_ajax_nonce")).toBe("testnonce");
      expect(params.get("order[0][dir]")).toBe("asc");
      expect(params.get("columns[5][data]")).toBe("stock_number");
      expect(params.get("params[log]")).toBe("false");
      const total = code === "595" ? (options.total ?? 101) : 2;
      const offset = Number(params.get("start"));
      const data = Array.from(
        { length: Math.min(100, total - offset) },
        (_, i) => {
          const index = offset + i + 1;
          const id = `${code}${index}`;
          const record: RtpRecord = {
            ...rtpTestRecord,
            id,
            yard_id: code,
            stock_number: String(index).padStart(12, "0"),
            vin: `1GNUKAE0X${String(Number(code) * 10000 + index).padStart(8, "0")}`,
            images: [
              {
                full: `https://upullandsave.com/yardsmart/${code}/${id}/6940706.jpg`,
              },
            ],
          };
          return options.record?.(record, index) ?? record;
        },
      );
      const page = {
        draw: params.get("draw") ?? "",
        recordsTotal: total,
        recordsFiltered: total,
        data,
      };
      return options.page?.(page, params) ?? Response.json(page);
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}
const noBatch = () => Effect.void;
const run = (
  startCursor?: RtpCursor,
  maxPages = 1,
  onBatch: (vehicles: RtpCanonicalVehicle[]) => Effect.Effect<void> = noBatch,
) =>
  Effect.runPromise(
    streamRtpInventoryWithRequestGate({ startCursor, maxPages, onBatch }, gate),
  );

test("RTP resumes native pages across all five qualified yards", async () => {
  const requests = mockInventory();
  const vehicles: RtpCanonicalVehicle[] = [];
  const onBatch = (batch: RtpCanonicalVehicle[]) =>
    Effect.sync(() => {
      vehicles.push(...batch);
    });
  const first = await run(undefined, 1, onBatch);
  expect(first).toMatchObject({
    count: 100,
    status: "paused",
    cursor: {
      yardCode: "595",
      offset: 100,
      total: 101,
      lastStock: "000000000100",
      emitted: 100,
      rejected: 0,
      excluded: 0,
    },
  });
  const second = await run(first.cursor, 2, onBatch);
  expect(second).toMatchObject({
    count: 3,
    status: "paused",
    pagesProcessed: 2,
    cursor: { phase: "start", yardCode: "232" },
  });
  const third = await run(second.cursor, 3, onBatch);
  expect(third).toMatchObject({
    count: 6,
    status: "complete",
    pagesProcessed: 3,
    cursor: { phase: "complete" },
  });
  expect(vehicles).toHaveLength(109);
  expect(new Set(vehicles.map((vehicle) => vehicle.vin)).size).toBe(109);
  expect(new Set(vehicles.map((vehicle) => vehicle.locationCode))).toEqual(
    new Set(["595", "1189", "232", "265", "298"]),
  );
  expect(requests).toHaveLength(12);
  expect(JSON.stringify(second.cursor)).not.toContain("nonce");
});

test("RTP preserves Savannah's published Raceway operator", async () => {
  mockInventory();
  const yards: RtpYard[] = [];
  await Effect.runPromise(
    streamRtpInventoryWithRequestGate(
      {
        startCursor: { source: "rtp", phase: "start", yardCode: "298" },
        maxPages: 1,
        onBatch: noBatch,
        onYards: (batch) =>
          Effect.sync(() => {
            yards.push(...batch);
          }),
      },
      gate,
    ),
  );
  expect(yards).toHaveLength(1);
  expect(yards[0]).toMatchObject({
    code: "298",
    operator: "Raceway Pik-A-Part",
    state: "TN",
    websiteUrl: "https://upullandsave.com/savannah-tn/raceway-pik-a-part/",
  });
});

test("RTP carries per-yard quality evidence across chunks instead of averaging yards", async () => {
  mockInventory({
    record: (record, index) =>
      record.yard_id === "595" && (index <= 10 || index === 101)
        ? { ...record, model: "Unknown" }
        : record,
  });
  const first = await run();
  expect(first).toMatchObject({
    count: 90,
    cursor: { rejected: 10, emitted: 90 },
  });
  let callbacks = 0;
  await expect(
    run(first.cursor, 2, () =>
      Effect.sync(() => {
        callbacks++;
      }),
    ),
  ).rejects.toThrow("per-yard quality");
  expect(callbacks).toBe(0);
});

test("RTP excludes inactive donors and protects independent VINs on incomplete donors", async () => {
  mockInventory({
    total: 20,
    record: (record, index) =>
      index === 1
        ? { ...record, active: "0" }
        : index === 2
          ? { ...record, model: "Unknown" }
          : record,
  });
  const result = await run();
  expect(result).toMatchObject({
    count: 18,
    accounting: {
      recordsProcessed: 20,
      recordsExcluded: 1,
      recordsRejected: 1,
    },
  });
  expect(result.observedVins).toHaveLength(1);
  expect(result.observedVins).toEqual(["1GNUKAE0X05950002"]);
});

test("RTP detects an ignored page even after a checkpoint is resumed", async () => {
  mockInventory();
  const first = await run();
  mockInventory({
    page: (page) =>
      Response.json({
        ...page,
        data: page.data.map((record) => ({
          ...record,
          stock_number: "000000000100",
        })),
      }),
  });
  await expect(run(first.cursor)).rejects.toThrow(
    "repeated or reordered stock",
  );
});

test("RTP admits donors with optional metadata absent without inflating rejection counts", async () => {
  mockInventory({
    total: 20,
    record: (record) => ({
      ...record,
      color: null,
      images: [],
      date_set: null,
      yard_row: null,
    }),
  });
  const vehicles: RtpCanonicalVehicle[] = [];
  const result = await run(undefined, 1, (batch) =>
    Effect.sync(() => {
      vehicles.push(...batch);
    }),
  );
  expect(result.accounting).toMatchObject({
    recordsProcessed: 20,
    recordsRejected: 0,
  });
  expect(vehicles).toHaveLength(20);
  expect(vehicles[0]).toMatchObject({
    color: null,
    imageUrl: null,
    availableDate: null,
    row: null,
  });
});

test("RTP stops when its source ordering key cannot prove complete pagination", async () => {
  mockInventory({ record: (record) => ({ ...record, stock_number: null }) });
  await expect(run()).rejects.toThrow("source stock ordering key");
});

test("RTP nulls malformed optional values at the response boundary", () => {
  expect(
    RtpRecordSchema.parse({
      ...rtpTestRecord,
      stock_number: 42,
      color: {},
      date_set: false,
      yard_row: [],
      images: [{ full: 42 }, false],
    }),
  ).toMatchObject({
    stock_number: null,
    color: null,
    date_set: null,
    yard_row: null,
    images: [{ full: null }, { full: null }],
  });
});

test("RTP rejects changed totals on resume", async () => {
  mockInventory();
  const first = await run();
  mockInventory({ total: 102 });
  await expect(run(first.cursor)).rejects.toThrow("total changed");
});

const corruptPages: ((page: Page) => Page)[] = [
  (page) => ({ ...page, draw: "99" }),
  (page) => ({ ...page, recordsFiltered: page.recordsTotal - 1 }),
  (page) => ({ ...page, data: page.data.slice(1) }),
  (page) => ({
    ...page,
    data: page.data.map((record) => ({ ...record, yard_id: "232" })),
  }),
  (page) => ({
    ...page,
    data: page.data.map((record) => ({ ...record, id: "1" })),
  }),
];
test.each(corruptPages)(
  "RTP fails closed on contradictory pagination or identities",
  async (corrupt) => {
    mockInventory({ page: (page) => Response.json(corrupt(page)) });
    await expect(run()).rejects.toThrow("contradictory");
  },
);

test.each([
  (html: string) => html.replace('"active":true', '"active":false'),
  (html: string) => html.replace('value="595"', 'value="151"'),
  (html: string) => html.replace('"phone":"(859) 586-3505"', '"phone":""'),
  (html: string) =>
    html.replace("url: 'https://upullandsave.com", "url: 'https://example.com"),
])(
  "RTP checks official yard identity and public AJAX configuration before requesting donors",
  async (context) => {
    const requests = mockInventory({ context });
    await expect(run()).rejects.toThrow();
    expect(requests).toHaveLength(1);
  },
);

test("RTP stops on HTTP 403 without retrying", async () => {
  const requests = mockInventory({
    page: () => new Response("Denied", { status: 403 }),
  });
  await expect(run()).rejects.toThrow("HTTP 403");
  expect(requests).toHaveLength(2);
});

test("RTP accepts the official cache footer after a complete HTML document", async () => {
  mockInventory({
    total: 2,
    context: (html) =>
      `${html}\n<!-- Performance optimized by Redis Object Cache. -->\n`,
  });
  expect((await run()).count).toBe(2);
});

test("RTP strips internal fields at the response boundary", () => {
  expect(
    RtpRecordSchema.parse({
      ...rtpTestRecord,
      notes: "private",
      events: [{ user_id: 42 }],
    }),
  ).toEqual(rtpTestRecord);
});

test("RTP rejects cursors without valid ordering and full accounting evidence", () => {
  expect(
    RtpCursorSchema.safeParse({ ...RtpCursor.initial, yardCode: "999999" })
      .success,
  ).toBe(false);
  const page = {
    source: "rtp",
    phase: "page",
    yardCode: "595",
    offset: 100,
    total: 101,
    lastStock: "000000000100",
    rejected: 0,
    excluded: 0,
    emitted: 99,
  };
  expect(RtpCursorSchema.safeParse(page).success).toBe(false);
  expect(RtpCursorSchema.safeParse({ ...page, emitted: 100 }).success).toBe(
    true,
  );
});

test("RTP complete checkpoints do not request upstream inventory", async () => {
  const requests = mockInventory();
  expect((await run({ source: "rtp", phase: "complete" })).status).toBe(
    "complete",
  );
  expect(requests).toHaveLength(0);
});
