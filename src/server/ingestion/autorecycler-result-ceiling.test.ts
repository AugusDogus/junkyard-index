import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { Effect } from "effect";
import { streamAutorecyclerInventoryWithPageFetcher } from "./autorecycler-connector";
import { Database } from "./context";

describe("AutoRecycler global result ceiling", () => {
  test.each([
    { startFrom: 0, pageRows: 400, atEnd: false, maxPages: 125 },
    { startFrom: 0, pageRows: 400, atEnd: true, maxPages: 250 },
    { startFrom: 49_600, pageRows: 400, atEnd: false, maxPages: 1 },
    { startFrom: 49_800, pageRows: 200, atEnd: true, maxPages: 1 },
    { startFrom: 49_900, pageRows: 200, atEnd: false, maxPages: 1 },
  ])(
    "fails closed when a page reaches the ceiling (%j)",
    async ({ startFrom, pageRows, atEnd, maxPages }) => {
      const client = createClient({ url: ":memory:" });
      let policyCalls = 0;
      let batches = 0;
      let yards = 0;
      try {
        const result = await Effect.runPromise(
          streamAutorecyclerInventoryWithPageFetcher(
            {
              startFrom,
              maxPages,
              onBatch: () =>
                Effect.sync(() => {
                  batches++;
                }),
              onYards: () =>
                Effect.sync(() => {
                  yards++;
                }),
            },
            async (from) => {
              const rows = from >= 50_000 ? 0 : pageRows;
              return {
                responses: [
                  {
                    at_end: from + rows >= 50_000 ? atEnd : false,
                    hits: {
                      hits: Array.from({ length: rows }, () => ({
                        _source: {},
                      })),
                    },
                  },
                ],
              };
            },
            () =>
              Effect.sync(() => {
                policyCalls++;
                return new Map<string, "independent">();
              }),
          ).pipe(
            Effect.provideService(Database, drizzle(client)),
            Effect.either,
          ),
        );
        expect(result._tag).toBe("Left");
        if (result._tag === "Right")
          throw new Error("Capped inventory was accepted");
        expect(result.left._tag).toBe("AutorecyclerProviderError");
        expect(result.left.message).toContain("50000-row result ceiling");
        expect(result.left.message).toContain(
          "previously published inventory is preserved",
        );
        expect(result.left.message).toContain("complete provider traversal");
        expect(batches).toBe(0);
        if (startFrom > 0) {
          expect(policyCalls).toBe(0);
          expect(yards).toBe(0);
        }
      } finally {
        client.close();
      }
    },
  );

  test.each([50_000, 50_400])(
    "rejects a resumed cursor at %s before requesting an empty terminal page",
    async (startFrom) => {
      const client = createClient({ url: ":memory:" });
      let requests = 0;
      try {
        const result = await Effect.runPromise(
          streamAutorecyclerInventoryWithPageFetcher(
            { startFrom, onBatch: () => Effect.void },
            async () => {
              requests++;
              return { responses: [{ at_end: true, hits: { hits: [] } }] };
            },
          ).pipe(
            Effect.provideService(Database, drizzle(client)),
            Effect.either,
          ),
        );
        expect(result._tag).toBe("Left");
        if (result._tag === "Right")
          throw new Error("Capped cursor was accepted");
        expect(result.left.message).toContain(`from=${startFrom}`);
        expect(result.left.message).toContain("50000-row result ceiling");
        expect(requests).toBe(0);
      } finally {
        client.close();
      }
    },
  );

  test.each([
    { rows: 99, atEnd: true, status: "complete" },
    { rows: 0, atEnd: false, status: "complete" },
    { rows: 99, atEnd: false, status: "paused" },
  ])(
    "preserves traversal below the ceiling (%j)",
    async ({ rows, atEnd, status }) => {
      const client = createClient({ url: ":memory:" });
      try {
        const result = await Effect.runPromise(
          streamAutorecyclerInventoryWithPageFetcher(
            { startFrom: 49_900, maxPages: 1, onBatch: () => Effect.void },
            async () => ({
              responses: [
                {
                  at_end: atEnd,
                  hits: {
                    hits: Array.from({ length: rows }, () => ({ _source: {} })),
                  },
                },
              ],
            }),
          ).pipe(Effect.provideService(Database, drizzle(client))),
        );
        expect(result.status).toBe(status);
        expect(result.cursor).toBe(49_900 + rows);
      } finally {
        client.close();
      }
    },
  );
});
