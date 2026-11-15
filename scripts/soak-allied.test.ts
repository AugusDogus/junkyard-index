import { expect, test } from "bun:test";
import { Effect } from "effect";
import { soakAlliedInventory } from "./soak-allied";
import { streamAlliedInventory } from "../src/server/ingestion/allied-connector";
import { ALLIED_CONTRACT } from "../src/server/ingestion/allied-configuration";
import { alliedFixture } from "../src/server/ingestion/allied-test-fixtures";
import { AlliedResult } from "../src/server/ingestion/allied-result";
import { AlliedCursor } from "../src/server/ingestion/allied-cursor";

test("Allied soak respects a physical GET cap and returns a serialized incomplete checkpoint", async () => {
  const requests: string[] = [];
  const docs = new Map([
    ["https://alliedautowrecking.com/", alliedFixture("owner")],
    ["https://alliedautowrecking.com/parts/", alliedFixture("makes")],
    [
      "https://alliedautowrecking.com/latest-arrivals/",
      alliedFixture("arrivals"),
    ],
  ]);
  const result = await soakAlliedInventory(
    (cursor, maxPages) =>
      Effect.runPromise(
        streamAlliedInventory({
          contract: ALLIED_CONTRACT,
          previousUniqueInventory: null,
          startCursor: cursor,
          maxPages,
          readPage: (url) => {
            requests.push(url);
            const raw = docs.get(url);
            return raw === undefined
              ? Effect.fail(
                  AlliedResult.error("fixture", "Uncaptured URL " + url),
                )
              : Effect.succeed(raw);
          },
          onBatch: () => Effect.die("Incomplete soak must not emit inventory"),
        }),
      ),
    3,
  );
  expect(requests).toHaveLength(3);
  expect(result.pagesProcessed).toBe(3);
  expect(result.status).toBe("paused");
  expect(result.count).toBe(0);
  expect(result.cursor.phase).toBe("makes");
});
test("Allied soak rejects stalled progress and invalid budgets", async () => {
  const stalled = () =>
    Promise.resolve({
      source: "allied" as const,
      status: "paused" as const,
      cursor: AlliedCursor.initial(ALLIED_CONTRACT),
      count: 0,
      pagesProcessed: 0,
      errors: [],
      warnings: [],
      observedVins: [],
      accounting: {
        recordsProcessed: 0,
        recordsRejected: 0,
        recordsExcluded: 0,
        duplicateVehicles: 0,
      },
    });
  await expect(soakAlliedInventory(stalled, 1)).rejects.toThrow(
    "made no progress",
  );
  await expect(soakAlliedInventory(stalled, 0)).rejects.toThrow(
    "positive integer",
  );
});
