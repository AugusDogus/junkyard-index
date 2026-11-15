import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { Effect } from "effect";
import { z } from "zod";
import { ALLIED_CONTRACT } from "./allied-configuration";
import { streamAlliedInventory } from "./allied-connector";
import { AlliedCursor } from "./allied-cursor";
import { AlliedResult } from "./allied-result";
import { alliedValue } from "./allied-test-fixtures";

test("Allied replays the complete ordered live census and closing controls before publishing", async () => {
  const responses = z
    .array(z.object({ url: z.string(), body: z.string() }).strict())
    .parse(
      JSON.parse(
        brotliDecompressSync(
          readFileSync(
            new URL("./allied-test-fixtures/census.json.br", import.meta.url),
          ),
        ).toString(),
      ),
    );
  let reads = 0;
  let batches = 0;
  let cursor = AlliedCursor.initial(ALLIED_CONTRACT);
  const readPage = (url: string) => {
    const response = responses[reads++];
    return response?.url === url
      ? Effect.succeed(response.body)
      : Effect.fail(
          AlliedResult.error(
            "offline census",
            `Unexpected request ${reads}: ${url}`,
          ),
        );
  };
  const onBatch = (vehicles: { vin: string }[]) =>
    Effect.sync(() => {
      expect(reads).toBe(responses.length);
      expect(new Set(vehicles.map((vehicle) => vehicle.vin)).size).toBe(
        vehicles.length,
      );
      batches++;
    });
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      streamAlliedInventory({
        contract: ALLIED_CONTRACT,
        previousUniqueInventory: null,
        startCursor: cursor,
        maxPages: 4,
        readPage,
        onBatch,
      }),
    );
    cursor = alliedValue(
      AlliedCursor.fromWire(
        alliedValue(AlliedCursor.serialize(result.cursor, ALLIED_CONTRACT)),
        ALLIED_CONTRACT,
      ),
    );
    if (result.status === "paused") {
      expect(batches).toBe(0);
      expect(result.count).toBe(0);
    } else {
      expect(result.count).toBe(2_507);
      expect(result.accounting).toEqual({
        recordsProcessed: 3_410,
        recordsRejected: 86,
        recordsExcluded: 778,
        duplicateVehicles: 39,
      });
      expect(result.warnings.join(" ")).toContain("not a yard total");
    }
  }
  expect(reads).toBe(577);
  expect(batches).toBe(1);
  const replay = await Effect.runPromise(
    streamAlliedInventory({
      contract: ALLIED_CONTRACT,
      previousUniqueInventory: null,
      startCursor: cursor,
      readPage,
      onBatch,
    }),
  );
  expect(replay.status).toBe("complete");
  expect(reads).toBe(577);
  expect(batches).toBe(1);
}, 120_000);
