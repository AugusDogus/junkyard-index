import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { Effect } from "effect";
import { Database } from "./context";
import { streamAutorecyclerInventoryWithPageFetcher } from "./autorecycler-connector";

describe("streamAutorecyclerInventory", () => {
  test("fetches full pages concurrently after establishing the provider page size", async () => {
    const client = createClient({ url: ":memory:" });
    const database = drizzle(client);
    let activeRequests = 0;
    let maximumActiveRequests = 0;

    try {
      const result = await Effect.runPromise(
        streamAutorecyclerInventoryWithPageFetcher(
          {
            onBatch: () => Effect.succeed(undefined),
            maxPages: 4,
          },
          async () => {
            activeRequests += 1;
            maximumActiveRequests = Math.max(
              maximumActiveRequests,
              activeRequests,
            );
            await new Promise((resolve) => setTimeout(resolve, 5));
            activeRequests -= 1;
            return {
              responses: [
                {
                  hits: {
                    hits: Array.from({ length: 400 }, () => ({
                      _source: {},
                    })),
                  },
                  at_end: false,
                },
              ],
            };
          },
        ).pipe(Effect.provideService(Database, database)),
      );

      expect(result.status).toBe("paused");
      expect(result.pagesProcessed).toBe(4);
      expect(result.cursor).toBe(1600);
      expect(maximumActiveRequests).toBe(3);
    } finally {
      client.close();
    }
  });
});
