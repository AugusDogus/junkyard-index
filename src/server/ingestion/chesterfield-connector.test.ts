import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import sharp from "sharp";
import { streamChesterfieldInventoryWithRequestGate } from "./chesterfield-connector";
import {
  ChesterfieldCursor,
  ChesterfieldCursorSchema,
} from "./chesterfield-cursor";
import { DonorPhotoStore } from "./donor-photo-store";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-cursor";
import {
  chesterfieldOffDirectoryRecord,
  chesterfieldPage,
  chesterfieldRecord,
} from "./chesterfield-test-fixtures";
import type { ChesterfieldCanonicalVehicle } from "./chesterfield-transform";
import type { ChesterfieldRecord } from "./chesterfield-parser";
import { chesterfieldPhotoIdentity } from "./chesterfield-photo";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect;
const photos = await Promise.all(
  ["green", "red", "blue"].map((background) =>
    sharp({ create: { width: 8, height: 8, channels: 3, background } })
      .jpeg()
      .toBuffer(),
  ),
);
const donors = ["Fort Lee", "Richmond", "Southside"].map(
  (yard, index): ChesterfieldRecord => {
    const signed = (pur: string) =>
      Buffer.from(
        JSON.stringify({ _rails: { pur, message: pur + index, exp: null } }),
      ).toString("base64url") +
      "--" +
      "a".repeat(40);
    return {
      ...chesterfieldRecord,
      yard,
      stock: String(85373 + index).padStart(12, "0"),
      vin: chesterfieldRecord.vin.slice(0, -1) + index,
      images: [
        "https://api.yardsmartapp.com/rails/active_storage/representations/redirect/" +
          signed("blob_id") +
          "/" +
          signed("variation") +
          "/image.jpg",
      ],
    };
  },
);
const footer = `<address><a href="https://www.google.com/maps/place/Richmond/!3d37.5070309!4d-77.4922793">Richmond Yard 5111 Old Midlothian Tpke, Richmond, VA 23224</a><a href="tel:+1-804-233-5481">(804) 233-5481</a></address>
<address><a href="https://www.google.com/maps/place/FortLee/!3d37.2457816!4d-77.3655118!3d37.2468736!4d-77.3669944">Ft. Lee Yard 4855 Puddledock Rd, Prince George, VA 23875</a><a href="tel:+1-804-732-9253">(804) 732-9253</a></address>
<address><a href="https://www.google.com/maps/place/Southside/!3d37.4510689!4d-77.6318571">Southside Yard 12910 Genito Rd, Midlothian, VA 23112</a><a href="tel:+1-804-744-0716">(804) 744-0716</a></address>`;

function mockInventory(
  options: {
    empty?: boolean;
    changed?: boolean;
    mediaFailure?: boolean;
    records?: ChesterfieldRecord[];
    newestRecords?: ChesterfieldRecord[];
    alter?: (
      records: ChesterfieldRecord[],
      query: number,
      modelId: string | null,
    ) => ChesterfieldRecord[];
    samePhotos?: boolean;
  } = {},
) {
  const requests: string[] = [];
  let searches = 0;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push(url.href);
      if (url.hostname === "api.yardsmartapp.com") {
        if (options.mediaFailure) return new Response(null, { status: 404 });
        const index = donors.findIndex((donor) =>
          donor.images.some(
            (reference) =>
              chesterfieldPhotoIdentity(reference) ===
              chesterfieldPhotoIdentity(url.href),
          ),
        );
        const photo = photos[options.samePhotos ? 0 : index];
        if (!photo) throw new Error("Unknown donor photo in test");
        return new Response(new Uint8Array(photo), {
          headers: { "content-type": "image/jpeg" },
        });
      }
      const records = options.empty ? [] : (options.records ?? donors);
      const results =
        init?.method === "POST"
          ? (options.alter?.(
              records,
              ++searches,
              new URLSearchParams(String(init.body)).get("BasicSearch.ModelId"),
            ) ?? records)
          : [];
      const emptyTable = chesterfieldPage([]).match(
        /<table>[\s\S]*?<\/table>/,
      )?.[0];
      if (!emptyTable)
        throw new Error("Test fixture needs an empty native table");
      const html =
        url.pathname === "/newest-cars"
          ? chesterfieldPage(options.newestRecords ?? donors).replace(
              "</table>",
              "</table>" + emptyTable.repeat(2),
            )
          : chesterfieldPage(results, {
              makeId: url.searchParams.get("SelectedMake.Id") ?? "298",
            });
      return new Response(
        html.replace(
          "</body>",
          (options.changed ? footer.replace("23875", "23876") : footer) +
            "</body>",
        ),
        { headers: { "content-type": "text/html" } },
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}
const run = (
  cursor: ChesterfieldCursor = ChesterfieldCursor.initial,
  store = DonorPhotoStore.memory(),
  vehicles: ChesterfieldCanonicalVehicle[] = [],
  maxPages = 6,
) =>
  Effect.runPromise(
    streamChesterfieldInventoryWithRequestGate(
      {
        startCursor: cursor,
        photoStore: store,
        appUrl: "https://index.example",
        maxPages,
        onBatch: (batch) =>
          Effect.sync(() => {
            vehicles.push(...batch);
          }),
      },
      gate,
    ),
  );

test("resumes serialized native directories and donor rows without duplicate emissions or signed URL checkpoints", async () => {
  const requests = mockInventory();
  const vehicles: ChesterfieldCanonicalVehicle[] = [];
  const store = DonorPhotoStore.memory();
  let cursor: ChesterfieldCursor = ChesterfieldCursor.initial;
  for (let chunk = 0; chunk < 10 && cursor.phase !== "complete"; chunk++) {
    const before = requests.length;
    const result = await run(cursor, store, vehicles);
    expect(result.pagesProcessed).toBe(requests.length - before);
    expect(result.pagesProcessed).toBeLessThanOrEqual(6);
    const serialized = serializeDurableSourceCursor(result.cursor);
    expect(serialized).not.toContain("__RequestVerificationToken");
    expect(serialized).not.toContain("active_storage");
    cursor = parseDurableSourceCursor("chesterfield", serialized);
  }
  expect(cursor.phase).toBe("complete");
  expect(vehicles).toHaveLength(3);
  expect(vehicles[0]).toMatchObject({
    source: "chesterfield",
    stockNumber: "000000085373",
    locationCity: "Prince George",
    stateAbbr: "VA",
    row: "Import 13 F",
    detailsUrl: "https://chesterfieldauto.com/search-our-inventory-by-location",
  });
  expect(vehicles[0]?.imageUrl).toMatch(
    /^https:\/\/index.example\/api\/inventory-photos\/[a-f0-9]{64}$/,
  );
  const before = requests.length;
  expect((await run(cursor, store)).pagesProcessed).toBe(0);
  expect(requests.length).toBe(before);
});

test("missing newest-car controls prevent completion", async () => {
  mockInventory({ empty: true });
  await expect(
    run(ChesterfieldCursor.initial, DonorPhotoStore.memory(), [], 16),
  ).rejects.toThrow("newest-car control");
});

const reachableControls = Array.from(
  { length: 10 },
  (_, index): ChesterfieldRecord => ({
    ...chesterfieldRecord,
    yard: ["Fort Lee", "Richmond", "Southside"][index % 3] ?? "Fort Lee",
    stock: String(86000 + index).padStart(12, "0"),
    vin: chesterfieldRecord.vin.slice(0, -1) + index,
    images: [],
  }),
);

test("newest cars whose make is absent from the native directory are not catalog controls", async () => {
  mockInventory({
    records: reachableControls,
    newestRecords: [...reachableControls, chesterfieldOffDirectoryRecord],
  });
  const vehicles: ChesterfieldCanonicalVehicle[] = [];
  const result = await run(
    ChesterfieldCursor.initial,
    DonorPhotoStore.memory(),
    vehicles,
    16,
  );
  expect(result.status).toBe("complete");
  expect(vehicles).toHaveLength(reachableControls.length);
  expect(result.warnings.join(" ")).toContain('["Richmond","000000086897"]');
});

test("a newest car of an off-directory make that is not pinned unsearchable prevents completion", async () => {
  const missingMake: ChesterfieldRecord = {
    ...chesterfieldRecord,
    make: "NISSAN",
    model: "ALTIMA",
    stock: "000000086898",
    vin: chesterfieldRecord.vin.slice(0, -1) + "9",
    images: [],
  };
  mockInventory({
    records: reachableControls,
    newestRecords: [...reachableControls, missingMake],
  });
  const vehicles: ChesterfieldCanonicalVehicle[] = [];
  await expect(
    run(ChesterfieldCursor.initial, DonorPhotoStore.memory(), vehicles, 16),
  ).rejects.toThrow(
    "Newest cars of make NISSAN are absent from the native make directory",
  );
  expect(vehicles).toHaveLength(0);
});

test("changed official yard metadata fails before donor emission", async () => {
  mockInventory({ changed: true });
  await expect(run()).rejects.toThrow("yard metadata");
});

test("photo failure preserves the input cursor and prevents accepted output", async () => {
  mockInventory({ mediaFailure: true });
  const vehicles: ChesterfieldCanonicalVehicle[] = [];
  const cursor = structuredClone(ChesterfieldCursor.initial);
  await expect(
    run(cursor, DonorPhotoStore.memory(), vehicles, 16),
  ).rejects.toThrow("published inventory is preserved");
  expect(cursor).toEqual(ChesterfieldCursor.initial);
  expect(vehicles).toHaveLength(0);
});

test("missing optional metadata emits null and requires no photo requests", async () => {
  const requests = mockInventory({
    records: donors.map((donor) => ({
      ...donor,
      color: "Unknown",
      position: "",
      arrivalDate: "",
      images: [],
    })),
  });
  const vehicles: ChesterfieldCanonicalVehicle[] = [];
  const result = await run(
    ChesterfieldCursor.initial,
    DonorPhotoStore.memory(),
    vehicles,
    32,
  );
  expect(result.status).toBe("complete");
  expect(result.accounting?.recordsRejected).toBe(0);
  expect(vehicles).toHaveLength(3);
  for (const vehicle of vehicles)
    expect(vehicle).toMatchObject({
      color: null,
      row: null,
      availableDate: null,
      imageUrl: null,
    });
  expect(requests.some((url) => url.includes("api.yardsmartapp.com"))).toBe(
    false,
  );
});

async function donorCheckpoint() {
  const store = DonorPhotoStore.memory();
  const vehicles: ChesterfieldCanonicalVehicle[] = [];
  const first = await run(ChesterfieldCursor.initial, store, vehicles);
  const second = await run(first.cursor, store, vehicles);
  if (second.cursor.phase !== "inventory" || second.cursor.rowIndex !== 1)
    throw new Error("Expected a checkpoint after the first donor");
  return {
    cursor: parseDurableSourceCursor(
      "chesterfield",
      serializeDurableSourceCursor(second.cursor),
    ),
    store,
    vehicles,
  };
}

test("resumed rows must match the checkpoint before any new emission", async () => {
  mockInventory();
  const { cursor, store, vehicles } = await donorCheckpoint();
  const before = structuredClone(cursor);
  mockInventory({
    records: donors.map((donor, index) =>
      index === 1 ? { ...donor, color: "BLUE" } : donor,
    ),
  });
  await expect(run(cursor, store, vehicles)).rejects.toThrow(
    "Search page changed",
  );
  expect(cursor).toEqual(before);
  expect(vehicles).toHaveLength(1);
});

test("rotating signed references preserve donor descriptions and permit row recovery", async () => {
  mockInventory();
  const { cursor, store, vehicles } = await donorCheckpoint();
  const renewed = donors.map((donor) => ({
    ...donor,
    images: donor.images.map((reference) => {
      const token =
        Buffer.from(
          JSON.stringify({
            _rails: {
              pur: "blob_id",
              message: chesterfieldPhotoIdentity(reference),
              exp: "2026-11-12T12:00:00Z",
            },
          }),
        ).toString("base64url") +
        "--" +
        "b".repeat(40);
      return reference.replace(/redirect\/[^/]+\//, "redirect/" + token + "/");
    }),
  }));
  mockInventory({ records: renewed });
  let next = cursor;
  for (let chunk = 0; chunk < 5 && next.phase !== "complete"; chunk++)
    next = (await run(next, store, vehicles)).cursor;
  expect(next.phase).toBe("complete");
  expect(vehicles).toHaveLength(3);
});

test.each(["blob", "content"] as const)(
  "rejects shared %s ownership across serialized chunks",
  async (kind) => {
    const firstDonor = donors[0];
    if (!firstDonor) throw new Error("Missing test donor");
    const records = donors.map((donor, index) =>
      index !== 1
        ? donor
        : kind === "blob"
          ? { ...donor, images: firstDonor.images }
          : donor,
    );
    mockInventory({ records, samePhotos: kind === "content" });
    const { cursor, store, vehicles } = await donorCheckpoint();
    await expect(run(cursor, store, vehicles)).rejects.toThrow(
      kind === "blob" ? "native photo identity" : "identical photo content",
    );
    expect(vehicles).toHaveLength(1);
  },
);

test("rejects a VIN reused by a different stock in a later native model query", async () => {
  const first = donors[0];
  const second = donors[1];
  if (!first || !second) throw new Error("Missing test donor");
  mockInventory({
    alter: (records, _query, modelId) =>
      modelId === "5017"
        ? records.filter((record) => record.stock !== second.stock)
        : [{ ...second, vin: first.vin }],
  });
  const { cursor, store, vehicles } = await donorCheckpoint();
  await expect(run(cursor, store, vehicles, 32)).rejects.toThrow("reuse VIN");
  expect(vehicles).toHaveLength(2);
});

test("duplicate VIN dialogs fail at the native parser boundary before emission", async () => {
  const first = donors[0];
  if (!first) throw new Error("Missing test donor");
  mockInventory({
    records: donors.map((donor, index) =>
      index === 1 ? { ...donor, vin: first.vin } : donor,
    ),
  });
  await expect(
    run(ChesterfieldCursor.initial, DonorPhotoStore.memory(), [], 32),
  ).rejects.toThrow("duplicate Chesterfield donor dialog ID");
});

test("a checkpoint cannot skip a row after its ownership evidence is removed", async () => {
  mockInventory();
  const { cursor, store } = await donorCheckpoint();
  if (cursor.phase !== "inventory")
    throw new Error("Expected donor checkpoint");
  await expect(run({ ...cursor, seen: [] }, store)).rejects.toThrow(
    "lacks ownership evidence",
  );
});

test("serialized checkpoints allow missing photos without allowing mixed media evidence", async () => {
  mockInventory();
  const store = DonorPhotoStore.memory();
  const first = await run(ChesterfieldCursor.initial, store);
  const second = await run(first.cursor, store, [], 7);
  if (second.cursor.phase !== "inventory" || second.cursor.seen.length !== 2)
    throw new Error("Expected two donor ownership records");
  const missingPhotos = {
    ...second.cursor,
    seen: second.cursor.seen.map((entry) => ({
      ...entry,
      photoHash: null,
      blobIdentity: null,
    })),
  };
  expect(
    parseDurableSourceCursor("chesterfield", JSON.stringify(missingPhotos)),
  ).toEqual(missingPhotos);
  expect(
    ChesterfieldCursorSchema.safeParse({
      ...missingPhotos,
      seen: missingPhotos.seen.map((entry) => ({
        ...entry,
        blobIdentity: "unpreserved-native-photo",
      })),
    }).success,
  ).toBe(false);
});

test("rejects contradictory repeat observations across native model queries", async () => {
  mockInventory({
    alter: (records, query) =>
      query === 1
        ? records
        : records.map((record) => ({ ...record, position: "Different 5" })),
  });
  await expect(
    run(ChesterfieldCursor.initial, DonorPhotoStore.memory(), [], 32),
  ).rejects.toThrow("Repeated donor descriptions disagree");
});

test("per-yard rejection cannot be diluted by complete donors at the other yards", async () => {
  const donor = donors[0];
  if (!donor) throw new Error("Missing test donor");
  const records = donors.map((donor, index) =>
    index === 0 ? { ...donor, model: "Unknown" } : donor,
  );
  mockInventory({
    records,
    newestRecords: records,
  });
  const store = DonorPhotoStore.memory();
  const first = await run(ChesterfieldCursor.initial, store);
  expect(first.observedVins).toEqual([donor.vin]);
  expect(first.accounting?.recordsRejected).toBe(1);
  await expect(run(first.cursor, store, [], 32)).rejects.toThrow(
    "Per-yard quality failed for Fort Lee: 1 rejected of 1",
  );
});

test("unidentified native rows fail instead of disappearing from quality accounting", async () => {
  mockInventory({
    records: donors.map((donor, index) =>
      index === 0 ? { ...donor, stock: "" } : donor,
    ),
  });
  await expect(
    run(ChesterfieldCursor.initial, DonorPhotoStore.memory(), [], 32),
  ).rejects.toThrow("unidentified yard or stock");
});

test("photo storage failures cannot advance a donor checkpoint", async () => {
  mockInventory();
  const store = DonorPhotoStore.memory();
  store.save = async () => {
    throw new Error("Disk full");
  };
  await expect(run(ChesterfieldCursor.initial, store, [], 32)).rejects.toThrow(
    "Disk full",
  );
});

test("rejects malformed ownership and row checkpoints before HTTP", async () => {
  mockInventory();
  const { cursor } = await donorCheckpoint();
  if (cursor.phase !== "inventory")
    throw new Error("Expected inventory checkpoint");
  for (const changed of [
    { ...cursor, rowIndex: 0 },
    { ...cursor, queryIndex: cursor.queries.length },
    { ...cursor, seen: [...cursor.seen, ...cursor.seen] },
    { ...cursor, queries: [...cursor.queries, ...cursor.queries] },
    { ...cursor, controls: [] },
  ])
    expect(ChesterfieldCursorSchema.safeParse(changed).success).toBe(false);
  const requests = mockInventory();
  await expect(run(cursor, DonorPhotoStore.memory(), [], 5)).rejects.toThrow(
    "6-32 HTTP requests",
  );
  expect(requests).toHaveLength(0);
});
