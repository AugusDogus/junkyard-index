import { afterEach, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import {
  streamBigdInventoryWithRequestGate,
  type BigdStreamResult,
} from "./bigd-connector";
import { BigdCursor } from "./bigd-cursor";
import { bigdNative } from "./bigd-test-fixtures";
import type { BigdVehicle } from "./bigd-snapshot";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-source";
import { BIGD_YARD } from "./bigd-yard-metadata";
import { VehicleDestination } from "~/lib/vehicle-destination";
import type { ProviderRequestGate } from "./provider-http-client";
const direct: ProviderRequestGate = (request) => request;
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function replay(patch?: (body: string, url: string, index: number) => string) {
  const calls: string[] = [];
  let inventories = 0,
    contacts = 0;
  const fetcher = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        const url = String(input);
        calls.push(url);
        let body: string;
        if (url === "https://bigdsalvage.com/")
          body = "<html><body>Public session</body></html>";
        else if (url === "https://bigdsalvage.com/contact/")
          body =
            ++contacts === 1 ? bigdNative.contact : bigdNative.closingContact;
        else if (url === "https://bigdsalvage.com/inventory/")
          body = ++inventories === 1 ? bigdNative.opening : bigdNative.closing;
        else throw new Error("Unmatched offline Big D request: " + url);
        return new Response(patch ? patch(body, url, calls.length) : body, {
          headers: { "content-type": "text/html" },
        });
      },
      { preconnect: originalFetch.preconnect },
    ),
  );
  return { calls, fetcher };
}
test("replays a complete census through serialized durable chunks and terminal resume", async () => {
  const { calls } = replay();
  let cursor: BigdCursor = BigdCursor.initial;
  const vehicles: BigdVehicle[] = [];
  const yards: unknown[] = [];
  for (let i = 0; i < 4; i++) {
    const result: BigdStreamResult = await Effect.runPromise(
      streamBigdInventoryWithRequestGate(
        {
          startCursor: cursor,
          maxPages: 1,
          onBatch: (batch) =>
            Effect.sync(() => {
              vehicles.push(...batch);
            }),
          onYards: (batch) =>
            Effect.sync(() => {
              yards.push(...batch);
            }),
        },
        direct,
      ),
    );
    cursor = parseDurableSourceCursor(
      "bigd",
      serializeDurableSourceCursor(result.cursor),
    );
    expect(result.status).toBe(i === 3 ? "complete" : "paused");
    expect(result.count).toBe(i === 3 ? 288 : 0);
    if (i < 3) expect(vehicles).toHaveLength(0);
  }
  expect(vehicles).toHaveLength(288);
  expect(yards).toEqual([BIGD_YARD]);
  expect(calls).toHaveLength(8);
  expect(
    VehicleDestination.resolve({ source: "bigd", detailsUrl: null }),
  ).toMatchObject({
    kind: "manual-search",
    href: "https://bigdsalvage.com/inventory/",
  });
  const result = await Effect.runPromise(
    streamBigdInventoryWithRequestGate(
      {
        startCursor: cursor,
        onBatch: () => Effect.die("No terminal callbacks"),
      },
      direct,
    ),
  );
  expect(result.count).toBe(0);
  expect(calls).toHaveLength(8);
});
test("a browser session reads the census without the direct-HTTP cookie bootstrap", async () => {
  // From Vercel, Cloudflare challenged every direct request, cookie or not.
  globalThis.fetch = Object.assign(
    async () => {
      throw new Error("Production Big D reads must not use direct HTTP");
    },
    { preconnect: originalFetch.preconnect },
  );
  const requested: string[] = [];
  let contacts = 0,
    inventories = 0;
  const fetchDocument = async (url: string) => {
    requested.push(url);
    const body =
      url === "https://bigdsalvage.com/contact/"
        ? ++contacts === 1
          ? bigdNative.contact
          : bigdNative.closingContact
        : url === "https://bigdsalvage.com/inventory/"
          ? ++inventories === 1
            ? bigdNative.opening
            : bigdNative.closing
          : null;
    if (body === null) throw new Error("Unexpected Big D request: " + url);
    return new Response(body, { headers: { "content-type": "text/html" } });
  };
  const vehicles: BigdVehicle[] = [];
  const result = await Effect.runPromise(
    streamBigdInventoryWithRequestGate(
      {
        maxPages: 4,
        onBatch: (batch) =>
          Effect.sync(() => {
            vehicles.push(...batch);
          }),
      },
      direct,
      { kind: "browser", fetchDocument },
    ),
  );
  expect(result.status).toBe("complete");
  expect(vehicles).toHaveLength(288);
  expect(requested).toEqual([
    "https://bigdsalvage.com/contact/",
    "https://bigdsalvage.com/inventory/",
    "https://bigdsalvage.com/contact/",
    "https://bigdsalvage.com/inventory/",
  ]);
});
test.each(["identity", "order", "optional", "ownership"] as const)(
  "blocks %s drift before callbacks",
  async (kind) => {
    replay((body, url, index) => {
      if (kind === "ownership" && url.endsWith("/contact/") && index === 4)
        return body.replaceAll("1296 E. Iona Rd.", "999 Unknown Rd.");
      if (url.endsWith("/inventory/") && index === 5) {
        if (kind === "identity")
          return body.replaceAll("5TBBT54178S460872", "5TBBT54178S460873");
        if (kind === "optional")
          return body.replace(">WHITE</td>", ">BLUE</td>");
        if (kind === "order")
          return body.replace(
            /(<tbody>)(<tr>[\s\S]*?<\/tr>)(<tr>[\s\S]*?<\/tr>)/,
            "$1$3$2",
          );
      }
      return body;
    });
    let callbacks = 0;
    await expect(
      Effect.runPromise(
        streamBigdInventoryWithRequestGate(
          {
            onBatch: () =>
              Effect.sync(() => {
                callbacks++;
              }),
            onYards: () =>
              Effect.sync(() => {
                callbacks++;
              }),
          },
          direct,
        ),
      ),
    ).rejects.toThrow();
    expect(callbacks).toBe(0);
  },
);
test("rejects cursor tampering and failed callbacks without an advanced checkpoint", async () => {
  const { calls } = replay();
  await expect(
    Effect.runPromise(
      streamBigdInventoryWithRequestGate(
        {
          startCursor: { ...BigdCursor.initial, checksum: "f".repeat(64) },
          onBatch: () => Effect.void,
        },
        direct,
      ),
    ),
  ).rejects.toThrow();
  expect(calls).toHaveLength(0);
  const result = await Effect.runPromise(
    streamBigdInventoryWithRequestGate(
      { maxPages: 2, onBatch: () => Effect.die("No partial emission") },
      direct,
    ),
  );
  const raw = BigdCursor.serialize(result.cursor).replace(
    "5TBBT54178S460872",
    "changed",
  );
  expect(() => BigdCursor.parse(raw)).toThrow();
  await expect(
    Effect.runPromise(
      streamBigdInventoryWithRequestGate(
        {
          startCursor: result.cursor,
          onBatch: () => Effect.fail(new Error("staging failed")),
        },
        direct,
      ),
    ),
  ).rejects.toThrow("staging failed");
});

test("resume after closing ownership still rereads the complete current table before admission", async () => {
  replay((body, url, index) =>
    url.endsWith("/inventory/") && index === 6
      ? body.replaceAll("5TBBT54178S460872", "5TBBT54178S460873")
      : body,
  );
  let emitted = 0;
  const options = {
    onBatch: (batch: BigdVehicle[]) =>
      Effect.sync(() => {
        emitted += batch.length;
      }),
  };
  const partial = await Effect.runPromise(
    streamBigdInventoryWithRequestGate({ ...options, maxPages: 3 }, direct),
  );
  expect(partial.cursor.phase).toBe("closing");
  expect(emitted).toBe(0);
  await expect(
    Effect.runPromise(
      streamBigdInventoryWithRequestGate(
        {
          ...options,
          startCursor: BigdCursor.parse(BigdCursor.serialize(partial.cursor)),
        },
        direct,
      ),
    ),
  ).rejects.toThrow("closing table changed");
  expect(emitted).toBe(0);
});
