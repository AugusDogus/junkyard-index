import { expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { streamAlshnedInventoryWithRequestGate } from "../src/server/ingestion/alshned-connector";
import { alshnedFixture } from "../src/server/ingestion/alshned-test-fixtures";
import { ALSHNED_CONTACT } from "../src/server/ingestion/alshned-parser";
import { soakAlshnedInventory } from "./soak-alshned";

test("Alshned capped soak preserves owner progress without partial inventory", async () => {
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        expect(String(input)).toBe(ALSHNED_CONTACT);
        return new Response(alshnedFixture("contact"), {
          headers: { "content-type": "text/html" },
        });
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  try {
    const result = await soakAlshnedInventory(
      (startCursor, maxPages) =>
        Effect.runPromise(
          streamAlshnedInventoryWithRequestGate(
            {
              previousAcceptedCount: null,
              startCursor,
              maxPages,
              onBatch: () => Effect.die("Partial inventory must not emit"),
            },
            (request) => request,
          ),
        ),
      1,
    );
    expect(result.status).toBe("paused");
    expect(result.cursor.phase).toBe("catalog");
    expect(result.count).toBe(0);
    expect(result.pagesProcessed).toBe(1);
  } finally {
    fetchSpy.mockRestore();
  }
});

test("Alshned soak rejects a claimed GET without checkpoint progress", async () => {
  await expect(
    soakAlshnedInventory(async (cursor) => ({
      source: "alshned",
      status: "paused",
      cursor,
      count: 0,
      pagesProcessed: 1,
      accounting: {
        recordsProcessed: 0,
        recordsRejected: 0,
        recordsExcluded: 0,
        duplicateVehicles: 0,
      },
      observedVins: [],
      errors: [],
      warnings: [],
    })),
  ).rejects.toThrow("no valid progress");
});
