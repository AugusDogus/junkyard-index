import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import type { IngestionSource } from "~/lib/ingestion-source";
import { createDurableIngestionRepository } from "./durable-ingestion-repository";
import { makeVehicle } from "./durable-ingestion-test-fixtures";
import {
  DURABLE_SOURCE_DEFINITIONS,
  serializeDurableSourceCursor,
} from "./durable-source";
import { validateDurableSourceRuns } from "./durable-source-validation";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import type { CanonicalVehicle } from "./types";

import { RECONCILIATION_TEST_SCHEMA } from "./durable-reconciliation-test-fixtures";

const RUN_STARTED_AT = new Date("2026-11-15T07:44:11.000Z");

/** A finished final checkpoint for the sources these tests validate. */
function defaultNextCursor(
  source: IngestionSource,
  vehicles: readonly CanonicalVehicle[],
): string {
  if (source === "autorecycler")
    return serializeDurableSourceCursor({
      source: "autorecycler",
      phase: "complete",
      freshness: {
        asOf: RUN_STARTED_AT.getTime(),
        legacy: {},
        eligibleYards: [...new Set(vehicles.map((v) => v.locationCode))],
      },
    });
  // TAP cursors carry no completion marker; the connector status is the proof.
  return serializeDurableSourceCursor(
    DURABLE_SOURCE_DEFINITIONS[source].initialCursor,
  );
}

/** Validates one terminal source snapshot in a run started at RUN_STARTED_AT. */
async function validateSnapshot(
  source: IngestionSource,
  vehicles: readonly CanonicalVehicle[],
  nextCursor = defaultNextCursor(source, vehicles),
) {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
    const database = drizzle(client);
    const snapshotStore = IngestionSnapshotStore.memory();
    await createDurableIngestionRepository(
      database,
      client,
      snapshotStore,
    ).initialize("validation");
    await client.execute({
      sql: "update ingestion_run set started_at = ? where id = 'validation'",
      args: [RUN_STARTED_AT.getTime()],
    });
    const pathname = await snapshotStore.put({
      runId: "validation",
      source,
      chunk: { vehicles: [...vehicles], observedVins: [] },
    });
    await client.execute({
      sql: "update ingestion_source_run set status = 'error' where source <> ?",
      args: [source],
    });
    await client.execute({
      sql: "update ingestion_source_run set status = 'success', vehicles_processed = ?, next_cursor = ?, snapshot_chunks = ? where source = ?",
      args: [vehicles.length, nextCursor, JSON.stringify([pathname]), source],
    });
    const result = await validateDurableSourceRuns({
      runId: "validation",
      database,
      batchClient: client,
      snapshotStore,
    });
    if (result.status !== "ready") throw new Error("Validation was skipped");
    return {
      accepted: result.acceptedSources.includes(source),
      errors:
        result.rejectedSources.find((rejected) => rejected.source === source)
          ?.errors ?? [],
    };
  } finally {
    client.close();
  }
}

function vehicles(
  source: IngestionSource,
  count: number,
  dated: (
    index: number,
  ) => Pick<CanonicalVehicle, "availableDate"> & Partial<CanonicalVehicle>,
): CanonicalVehicle[] {
  return Array.from({ length: count }, (_, index) => ({
    ...makeVehicle(`1HGCM82633A${String(index).padStart(6, "0")}`),
    source,
    ...dated(index),
  }));
}

describe("durable source validation inventory age", () => {
  test("rejects a TAP feed frozen at its early-August yard dates", async () => {
    // TAP passes yard_in_date through as a zoneless local timestamp.
    const frozen = vehicles("upullitne", 2_536, () => ({
      availableDate: "2026-08-05T13:01:00.000",
    }));
    const result = await validateSnapshot("upullitne", frozen);
    expect(result.accepted).toBe(false);
    expect(result.errors).toHaveLength(1);
    // The zoneless date lands on Aug 4, 5, or 6 UTC depending on the host zone.
    expect(result.errors[0]).toMatch(
      /^upullitne newest vehicle arrived 2026-08-0[4-6], 10[0-2] days before this run; a feed with nothing newer than 30 days is treated as frozen\./,
    );
  });

  test("accepts a TAP feed whose newest vehicle is recent", async () => {
    const current = vehicles("tearapart", 600, (index) => ({
      availableDate:
        index === 0 ? "2026-11-10T08:48:09.737" : "2026-08-04T07:56:35.930",
    }));
    expect(await validateSnapshot("tearapart", current)).toEqual({
      accepted: true,
      errors: [],
    });
  });

  test("accepts AutoRecycler when only some of its yards are stale", async () => {
    const mixed = vehicles("autorecycler", 100, (index) =>
      index < 99
        ? { availableDate: "2026-08-10T00:00:00.000Z", locationCode: "stale" }
        : { availableDate: "2026-11-13T00:00:00.000Z", locationCode: "fresh" },
    );
    expect(await validateSnapshot("autorecycler", mixed)).toEqual({
      accepted: true,
      errors: [],
    });
  });
});

describe("durable source validation terminal evidence", () => {
  const recent = (count: number) =>
    vehicles("rightway", count, () => ({
      availableDate: "2026-11-10T00:00:00.000Z",
    }));

  test("rejects a successful run whose final cursor stopped mid-crawl", async () => {
    const midCrawl = serializeDurableSourceCursor(
      DURABLE_SOURCE_DEFINITIONS.rightway.initialCursor,
    );
    expect(await validateSnapshot("rightway", recent(200), midCrawl)).toEqual({
      accepted: false,
      errors: ["rightway did not provide terminal cursor evidence"],
    });
  });

  test("accepts the same run once its final cursor records completion", async () => {
    const complete = serializeDurableSourceCursor({
      source: "rightway",
      phase: "complete",
    });
    expect(await validateSnapshot("rightway", recent(200), complete)).toEqual({
      accepted: true,
      errors: [],
    });
  });
});
