import { createClient, type Client } from "@libsql/client";
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync } from "node:fs";
import { HiddenSources } from "~/lib/hidden-source";
import { YardInventory } from "~/lib/yard-inventory";
import { RECONCILIATION_TEST_SCHEMA } from "./ingestion/durable-reconciliation-test-fixtures";
import { stateRecentArrivalRebuildStatements } from "./ingestion/state-recent-arrival";
import { yardInventoryRefreshStatements } from "./ingestion/yard-inventory";
import { StateNewArrivals } from "./state-new-arrivals";

const DAY = 24 * 60 * 60 * 1000;

type Fixture = {
  vin: string;
  source: string;
  state: string;
  availableDate: string | null;
  observedArrivalAt: number | null;
  firstSeenAt: number;
};

async function insert(client: Client, vehicles: readonly Fixture[]) {
  for (const row of vehicles) {
    await client.execute({
      sql: `insert into vehicle (vin, source, year, make, model, location_code,
        location_name, location_city, state, state_abbr, lat, lng,
        available_date, observed_arrival_at, first_seen_at, last_seen_at)
        values (?, ?, 2010, 'Honda', 'Civic', 'yard', 'Yard', 'City', 'State',
        ?, 30, -90, ?, ?, ?, ?)`,
      args: [
        row.vin,
        row.source,
        row.state,
        row.availableDate,
        row.observedArrivalAt,
        row.firstSeenAt,
        row.firstSeenAt,
      ],
    });
  }
}

/** What the state page counted before the summary: every live vehicle. */
async function scanCounts(
  client: Client,
  hidden: readonly string[],
  referenceTime: string,
): Promise<Record<string, number>> {
  const rows = (
    await client.execute(
      "select source, state_abbr, available_date, observed_arrival_at, first_seen_at from vehicle where missing_since_at is null",
    )
  ).rows;
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (hidden.includes(String(row.source))) continue;
    const added = YardInventory.added(
      row.available_date === null ? null : String(row.available_date),
      Number(row.first_seen_at),
      row.observed_arrival_at === null ? null : Number(row.observed_arrival_at),
    );
    if (!YardInventory.isNew(added, referenceTime)) continue;
    const state = String(row.state_abbr);
    counts[state] = (counts[state] ?? 0) + 1;
  }
  return counts;
}

function fixtures(now: number): Fixture[] {
  return [
    // Yard dates in both stored shapes.
    {
      vin: "A-yard-day",
      source: "pyp",
      state: "TX",
      availableDate: new Date(now - 4 * DAY).toISOString().slice(0, 10),
      observedArrivalAt: null,
      firstSeenAt: now - 4 * DAY,
    },
    {
      vin: "B-yard-time",
      source: "pyp",
      state: "TX",
      availableDate: new Date(now - 4 * DAY + 36_000_000).toISOString(),
      observedArrivalAt: null,
      firstSeenAt: now - 4 * DAY,
    },
    // Observed arrival without a yard date.
    {
      vin: "C-observed",
      source: "pyp",
      state: "TX",
      availableDate: null,
      observedArrivalAt: now - 2 * DAY,
      firstSeenAt: now - 2 * DAY,
    },
    // An old yard date outranks a recent observation.
    {
      vin: "D-old-yard",
      source: "pyp",
      state: "TX",
      availableDate: "2024-01-05",
      observedArrivalAt: now - DAY,
      firstSeenAt: now - DAY,
    },
    // First indexed only: never new.
    {
      vin: "E-first-seen",
      source: "pyp",
      state: "TX",
      availableDate: null,
      observedArrivalAt: null,
      firstSeenAt: now - DAY,
    },
    {
      vin: "F-other-state",
      source: "pyp",
      state: "CA",
      availableDate: new Date(now - 3 * DAY).toISOString(),
      observedArrivalAt: null,
      firstSeenAt: now - 3 * DAY,
    },
    {
      vin: "G-other-source",
      source: "row52",
      state: "TX",
      availableDate: new Date(now - 2 * DAY).toISOString(),
      observedArrivalAt: null,
      firstSeenAt: now - 2 * DAY,
    },
    // Dated after the render: stored, counted once its date passes.
    {
      vin: "H-future",
      source: "pyp",
      state: "TX",
      availableDate: new Date(now + 2 * DAY).toISOString(),
      observedArrivalAt: null,
      firstSeenAt: now - DAY,
    },
  ];
}

test("state new counts follow publishes, departures and restores like a vehicle scan", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
    const now = Date.parse("2026-11-24T12:00:00.000Z");
    await insert(client, fixtures(now));
    const database = drizzle(client);
    const counts = (referenceTime: number, hidden: readonly string[] = []) =>
      StateNewArrivals.counts(
        database,
        HiddenSources.of(hidden),
        new Date(referenceTime).toISOString(),
      );
    const expectScan = async (
      referenceTime: number,
      expected: Record<string, number>,
      hidden: readonly string[] = [],
    ) => {
      expect(
        await scanCounts(client, hidden, new Date(referenceTime).toISOString()),
      ).toEqual(expected);
      expect(await counts(referenceTime, hidden)).toEqual(expected);
    };

    // Nothing is published yet.
    expect(await counts(now)).toEqual({});

    // Insert: the publish batch stores each source's recent arrivals.
    await client.batch(
      yardInventoryRefreshStatements(["pyp", "row52"], now),
      "write",
    );
    await expectScan(now, { TX: 4, CA: 1 });
    await expectScan(now, { TX: 3, CA: 1 }, ["row52"]);
    // Only recent arrivals are stored, not the whole inventory: everything
    // but the vehicle known only by its first indexed date.
    expect(
      Number(
        (
          await client.execute(
            "select sum(vehicle_count) as n from state_recent_arrival",
          )
        ).rows[0]?.n,
      ),
    ).toBe(7);

    // Departure: a vehicle that leaves stops counting once its source refreshes.
    await client.execute({
      sql: "update vehicle set missing_since_at = ? where vin = 'A-yard-day'",
      args: [now],
    });
    await client.batch(yardInventoryRefreshStatements(["pyp"], now), "write");
    await expectScan(now, { TX: 3, CA: 1 });

    // Restore: it counts again when it comes back.
    await client.execute(
      "update vehicle set missing_since_at = null where vin = 'A-yard-day'",
    );
    await client.batch(yardInventoryRefreshStatements(["pyp"], now), "write");
    await expectScan(now, { TX: 4, CA: 1 });

    // Without another publish, later renders still count the exact week:
    // older arrivals age out and future-dated ones age in.
    await expectScan(now + 3 * DAY, { TX: 4, CA: 1 });
    await expectScan(now + 6 * DAY, { TX: 1 });

    // A source whose last vehicle left has no rows left.
    await client.execute({
      sql: "update vehicle set missing_since_at = ? where source = 'row52'",
      args: [now],
    });
    await client.batch(yardInventoryRefreshStatements(["row52"], now), "write");
    await expectScan(now, { TX: 3, CA: 1 });
    expect(
      (
        await client.execute(
          "select count(*) as n from state_recent_arrival where source = 'row52'",
        )
      ).rows[0]?.n,
    ).toBe(0);
  } finally {
    client.close();
  }
});

test("a full rebuild replaces every source's recent arrivals from live inventory", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
    const now = Date.parse("2026-11-24T12:00:00.000Z");
    // A database whose vehicles arrived after migrating, plus a stale row.
    await insert(client, fixtures(now));
    await client.execute({
      sql: "insert into state_recent_arrival (source, state_abbr, available_date, observed_arrival_at, vehicle_count) values ('gone', 'NV', null, ?, 9)",
      args: [now - DAY],
    });
    await client.batch(stateRecentArrivalRebuildStatements(now), "write");
    const referenceTime = new Date(now).toISOString();
    expect(
      await StateNewArrivals.counts(
        drizzle(client),
        HiddenSources.none,
        referenceTime,
      ),
    ).toEqual(await scanCounts(client, [], referenceTime));
    expect(await scanCounts(client, [], referenceTime)).toEqual({
      TX: 4,
      CA: 1,
    });
  } finally {
    client.close();
  }
});

test("the migration backfills recent arrivals from live inventory", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    const migration = readFileSync(
      new URL("../../drizzle/0032_state_recent_arrival.sql", import.meta.url),
      "utf8",
    );
    // The shared schema already applies the migration; start from before it.
    await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
    await client.execute("drop table state_recent_arrival");
    await insert(client, fixtures(Date.now()));
    await client.executeMultiple(
      migration.replaceAll("--> statement-breakpoint", ""),
    );
    const referenceTime = new Date().toISOString();
    expect(
      await StateNewArrivals.counts(
        drizzle(client),
        HiddenSources.none,
        referenceTime,
      ),
    ).toEqual(await scanCounts(client, [], referenceTime));
    expect(await scanCounts(client, [], referenceTime)).toEqual({
      TX: 4,
      CA: 1,
    });
  } finally {
    client.close();
  }
});
