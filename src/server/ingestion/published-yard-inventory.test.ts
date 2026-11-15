import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { makeVehicle } from "./durable-ingestion-test-fixtures";
import { validatePublishedYardInventory } from "./published-yard-inventory";

test.each([
  { previous: 4, minimum: 2, expectedErrors: [] },
  {
    previous: 5,
    minimum: 2,
    expectedErrors: [
      "urgiis small-yard inventory fell from 5 to 2, below the 50% yard drift limit; previously published inventory is preserved. Inspect the complete yard catalog before retrying.",
    ],
  },
  {
    previous: 4,
    minimum: 3,
    expectedErrors: [
      "urgiis small-yard has 2 donors, below its qualified yard floor 3; previously published inventory is preserved. Inspect the complete yard catalog before retrying.",
    ],
  },
])(
  "URG IIS checks persisted drift per physical yard: previous=$previous, floor=$minimum",
  async ({ previous, minimum, expectedErrors }) => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.execute(
        "create table vehicle (vin text primary key, source text, location_code text, missing_since_at integer)",
      );
      const prior = [
        ...Array.from({ length: previous }, (_, i) => ({
          vin: `active-${i}`,
          source: "urgiis",
          missing: null,
        })),
        ...Array.from({ length: 6 }, (_, i) => ({
          vin: `retired-${i}`,
          source: "urgiis",
          missing: 1,
        })),
        { vin: "another-source", source: "cars4parts", missing: null },
      ];
      await client.batch(
        prior.map((row) => ({
          sql: "insert into vehicle values (?, ?, 'small-yard', ?)",
          args: [row.vin, row.source, row.missing],
        })),
        "write",
      );
      const current = Array.from({ length: 2 }, (_, i) => ({
        ...makeVehicle(`current-${i}`),
        source: "urgiis" as const,
        locationCode: "small-yard",
      }));
      expect(
        await validatePublishedYardInventory(
          drizzle(client),
          current,
          "urgiis",
          new Map([["small-yard", minimum]]),
        ),
      ).toEqual([...expectedErrors]);
      expect(
        await client.execute("select count(*) as count from vehicle"),
      ).toMatchObject({ rows: [{ count: previous + 7 }] });
    } finally {
      client.close();
    }
  },
);
