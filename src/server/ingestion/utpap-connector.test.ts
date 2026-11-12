import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import sharp from "sharp";
import { DonorPhotoStore } from "./donor-photo-store";
import { streamUtpapInventoryWithRequestGate } from "./utpap-connector";
import { UtpapCursor, UtpapCursorSchema } from "./utpap-cursor";
import {
  utpapTestContact,
  utpapTestPage,
  utpapTestRecord,
  utpapTestXml,
} from "./utpap-test-fixtures";
import type { UtpapCanonicalVehicle } from "./utpap-transform";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect;
const photos = await Promise.all(
  ["red", "blue"].map((background) =>
    sharp({ create: { width: 8, height: 8, channels: 3, background } })
      .jpeg()
      .toBuffer(),
  ),
);
function mockSource(
  options: {
    change?: (body: string, path: string) => string;
    missingPhoto?: boolean;
    photoStatus?: number;
    reusedPhoto?: boolean;
  } = {},
) {
  const requests: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.origin).toBe("https://utpap.com");
      requests.push(url.pathname + url.search);
      if (url.pathname.endsWith(".jpeg"))
        return options.missingPhoto || options.photoStatus
          ? new Response(options.photoStatus ? "Photo unavailable" : null, {
              status: options.photoStatus ?? 404,
            })
          : new Response(
              new Uint8Array(
                photos[
                  url.pathname.includes("Orem") && !options.reusedPhoto ? 1 : 0
                ] ?? [],
              ),
              { headers: { "Content-Type": "image/jpeg" } },
            );
      const orem =
        url.pathname.includes("orem") ||
        url.pathname.includes("Orem") ||
        url.pathname.startsWith("/1065");
      const code = orem ? "1065" : "1064";
      const city = orem ? "Orem" : "Ogden";
      let body: string;
      let kind = "text/html";
      if (url.pathname.endsWith("_inventory.xml")) {
        body = orem
          ? utpapTestXml([
              {
                ...utpapTestRecord,
                S3CLIENTID: "1065",
                YARD_NAME: "UTAH PIC-A-PART OREM",
                YARD_CITY: "OREM",
                STOCKNUMBER: "K039846",
                VIN: "2HNYD186X4H538061",
              },
            ])
          : utpapTestXml();
        kind = "text/xml";
      } else if (url.pathname.startsWith("/search-inventory_"))
        body = orem
          ? utpapTestPage({ stock: "K039846" }).replaceAll(
              "Ogden-inventory-photos",
              "Orem-inventory-photos",
            )
          : utpapTestPage();
      else if (url.pathname.startsWith("/invupdPremium"))
        body =
          "<html><script>fetch('" + code + "_inventory.xml')</script></html>";
      else if (url.pathname.endsWith("-premium-inventory/"))
        body =
          '<html><iframe src="https://utpap.com/invupdPremium' +
          city +
          '.html"></iframe></html>';
      else if (url.pathname.endsWith("-inventory/"))
        body = utpapTestContact.replace(
          "</body>",
          '<iframe src="https://utpap.com/search-inventory_' +
            city.toLowerCase() +
            '.php"></iframe></body>',
        );
      else throw new Error("Unexpected Utah test request " + url.pathname);
      return new Response(options.change?.(body, url.pathname) ?? body, {
        headers: { "Content-Type": kind },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}
async function complete(maxPages = 32, store = DonorPhotoStore.memory()) {
  let cursor: UtpapCursor = UtpapCursor.initial;
  const vehicles: UtpapCanonicalVehicle[] = [];
  let processed = 0;
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      streamUtpapInventoryWithRequestGate(
        {
          startCursor: cursor,
          maxPages,
          photoStore: store,
          appOrigin: "https://junkyardindex.com",
          onBatch: (batch) =>
            Effect.sync(() => {
              vehicles.push(...batch);
            }),
        },
        gate,
      ),
    );
    cursor = UtpapCursorSchema.parse(result.cursor);
    processed += result.accounting?.recordsProcessed ?? 0;
  }
  return { cursor, vehicles, processed };
}
test("Utah resumes native make and photo checkpoints and preserves both yards' photos", async () => {
  const requests = mockSource();
  const result = await complete(1);
  expect(result.cursor.phase).toBe("complete");
  expect(result.vehicles.map((v) => v.locationCode)).toEqual(["1064", "1065"]);
  expect(result.processed).toBe(2);
  expect(
    result.vehicles.every((v) =>
      v.imageUrl?.startsWith("https://junkyardindex.com/api/inventory-photos/"),
    ),
  ).toBe(true);
  expect(requests.filter((path) => path.endsWith(".jpeg"))).toHaveLength(2);
  expect(requests.filter((path) => path.includes("?make=ACURA"))).toHaveLength(
    2,
  );
});
test("Utah rejects XML/native catalog disagreements before emitting or preserving photos", async () => {
  const requests = mockSource({
    change: (body, path) =>
      path.startsWith("/search-inventory_")
        ? body.replaceAll("A039820", "A039821")
        : body,
  });
  await expect(complete()).rejects.toThrow("disagree");
  expect(requests.some((path) => path.endsWith(".jpeg"))).toBe(false);
});
test("Utah aborts when a valid published donor photo returns HTTP 404", async () => {
  mockSource({ missingPhoto: true });
  await expect(complete()).rejects.toThrow("HTTP 404");
});
test("Utah resumes and emits donors with absent photos without requesting image bytes", async () => {
  const requests = mockSource({
    change: (body, path) =>
      path.startsWith("/search-inventory_")
        ? body.replace(/<td><a\b[^>]*><img\b[^>]*><\/a><\/td>/g, "<td></td>")
        : body,
  });
  const result = await complete(1);
  expect(result.vehicles).toHaveLength(2);
  expect(result.vehicles.every((vehicle) => vehicle.imageUrl === null)).toBe(
    true,
  );
  expect(requests.some((path) => path.endsWith(".jpeg"))).toBe(false);
});
test("Utah fails provided photo transport and storage errors without emitting optional nulls", async () => {
  mockSource({ photoStatus: 500 });
  await expect(complete()).rejects.toThrow("HTTP 500");
  mockSource();
  const store = DonorPhotoStore.memory();
  await expect(
    complete(32, {
      ...store,
      async save() {
        throw new Error("Local photo storage unavailable");
      },
    }),
  ).rejects.toThrow("Local photo storage unavailable");
});
test("Utah preserves provided photos when optional colors are unknown", async () => {
  const requests = mockSource({
    change: (body, path) =>
      path.endsWith("_inventory.xml")
        ? body.replace(/<COLOR>[^<]*<\/COLOR>/g, "<COLOR />")
        : body,
  });
  const result = await complete(1);
  expect(result.vehicles).toHaveLength(2);
  expect(
    result.vehicles.every(
      (vehicle) => vehicle.color === null && vehicle.imageUrl !== null,
    ),
  ).toBe(true);
  expect(requests.filter((path) => path.endsWith(".jpeg"))).toHaveLength(2);
});
test("Utah emits null optional photos without requesting invalid references", async () => {
  const requests = mockSource({
    change: (body, path) =>
      path.startsWith("/search-inventory_")
        ? body.replace(
            /src="[^"]+\.jpeg"/g,
            'src="https://example.com/donor.jpeg"',
          )
        : body,
  });
  const result = await complete(1);
  expect(result.vehicles).toHaveLength(2);
  expect(result.vehicles.every((vehicle) => vehicle.imageUrl === null)).toBe(
    true,
  );
  expect(requests.some((path) => path.endsWith(".jpeg"))).toBe(false);
});
test("Utah rejects category-valued make instead of inventing motorcycle manufacturer/model fields", async () => {
  mockSource({
    change: (body, path) =>
      path.endsWith("_inventory.xml")
        ? body.replace("<MAKE>ACURA", "<MAKE>ATV / MOTORCYCLE")
        : path.startsWith("/search-inventory_")
          ? body.replaceAll("ACURA", "ATV / MOTORCYCLE")
          : body,
  });
  await expect(complete()).rejects.toThrow("10%");
});
test("Utah rejects reused donor image bytes across physical yards", async () => {
  mockSource({ reusedPhoto: true });
  await expect(complete()).rejects.toThrow("same photo bytes");
});
test("Utah validates official yard metadata before any donor emission", async () => {
  mockSource({
    change: (body) => body.replaceAll("801)612-6446", "801)612-6447"),
  });
  await expect(complete()).rejects.toThrow("contact identity");
});
test("Utah terminal cursor makes no source requests", async () => {
  const requests = mockSource();
  const result = await Effect.runPromise(
    streamUtpapInventoryWithRequestGate(
      {
        startCursor: { source: "utpap", phase: "complete" },
        photoStore: DonorPhotoStore.memory(),
        appOrigin: "https://junkyardindex.com",
        onBatch: () => Effect.void,
      },
      gate,
    ),
  );
  expect(result.status).toBe("complete");
  expect(requests).toEqual([]);
});

test.each([1, 2])(
  "Utah retains the 10%% per-yard rejection boundary with %d invalid required identities",
  async (rejected) => {
    const requests = mockSource();
    const donors = Array.from({ length: 10 }, (_, index) => ({
      record: {
        ...utpapTestRecord,
        VIN: utpapTestRecord.VIN.slice(0, -2) + String(index).padStart(2, "0"),
        STOCKNUMBER: "A" + String(index).padStart(6, "0"),
        MAKE: index < rejected ? "ATV / MOTORCYCLE" : "ACURA",
        COLOR: "UNKNOWN",
      },
      photo: null,
    }));
    const run = Effect.runPromise(
      streamUtpapInventoryWithRequestGate(
        {
          startCursor: {
            ...UtpapCursor.initial,
            phase: "photos",
            donors,
            index: 0,
            rejected: 0,
            emitted: 0,
            vins: [],
            hashes: [],
          },
          maxPages: 10,
          photoStore: DonorPhotoStore.memory(),
          appOrigin: "https://junkyardindex.com",
          onBatch: () => Effect.void,
        },
        gate,
      ),
    );
    if (rejected === 1) {
      const result = await run;
      const firstDonor = donors[0];
      if (!firstDonor) throw new Error("Expected ten native donor fixtures");
      expect(result.count).toBe(9);
      expect(result.accounting?.recordsRejected).toBe(1);
      expect(result.observedVins).toEqual([firstDonor.record.VIN]);
      expect(UtpapCursorSchema.parse(result.cursor).phase).toBe("start");
    } else await expect(run).rejects.toThrow("10%");
    expect(requests).toEqual([]);
  },
);
