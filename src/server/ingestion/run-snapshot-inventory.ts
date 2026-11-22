import { parseDurableSourceCursor } from "./durable-cursor";
import { urgiisPublication } from "./urgiis-publication";
import { and, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
  isIngestionSource,
  type IngestionSource,
} from "~/lib/ingestion-source";
import { ingestionSourceRun } from "~/schema";
import { parseSnapshotChunks } from "./durable-ingestion-repository";
import type { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import { reconciliationSourcePriority } from "./reconciliation-policy";
import type { CanonicalVehicle } from "./types";

export interface SourceSnapshot {
  /** First snapshot of each VIN in checkpoint order. */
  vehicles: Map<string, CanonicalVehicle>;
  observedVins: Set<string>;
}

/** Final run inventory: one vehicle per VIN from its highest-priority source. */
export interface RunSnapshotInventory {
  vehicles: Map<string, CanonicalVehicle>;
  /** VINs ordered for cursor-based reconciliation batches. */
  vins: string[];
  observedVins: Set<string>;
  /** Observations ordered for bounded VIN lookups during missing reconciliation. */
  observedVinOrder: string[];
  acceptedSources: Set<IngestionSource>;
  preservedUrgiisYards: Set<string>;
  preservedAutorecyclerYards: Set<string>;
}

export async function loadSourceSnapshot(
  store: IngestionSnapshotStore,
  snapshotChunks: string,
): Promise<SourceSnapshot> {
  const snapshot: SourceSnapshot = {
    vehicles: new Map(),
    observedVins: new Set(),
  };
  for (const pathname of parseSnapshotChunks(snapshotChunks)) {
    const chunk = await store.load(pathname);
    if (chunk.restart) {
      snapshot.vehicles.clear();
      snapshot.observedVins.clear();
    }
    for (const vehicle of chunk.vehicles)
      if (!snapshot.vehicles.has(vehicle.vin))
        snapshot.vehicles.set(vehicle.vin, vehicle);
    for (const vin of chunk.observedVins) snapshot.observedVins.add(vin);
  }
  return snapshot;
}

export async function loadRunSnapshotInventory(params: {
  runId: string;
  database: LibSQLDatabase;
  store: IngestionSnapshotStore;
}): Promise<RunSnapshotInventory> {
  const rows = await params.database
    .select({
      source: ingestionSourceRun.source,
      nextCursor: ingestionSourceRun.nextCursor,
      snapshotChunks: ingestionSourceRun.snapshotChunks,
    })
    .from(ingestionSourceRun)
    .where(
      and(
        eq(ingestionSourceRun.runId, params.runId),
        eq(ingestionSourceRun.acceptanceStatus, "accepted"),
      ),
    );
  const accepted = rows
    .flatMap((row) =>
      isIngestionSource(row.source) ? [{ ...row, source: row.source }] : [],
    )
    .sort(
      (a, b) =>
        reconciliationSourcePriority(a.source) -
        reconciliationSourcePriority(b.source),
    );
  const inventory: RunSnapshotInventory = {
    preservedUrgiisYards: new Set(),
    vehicles: new Map(),
    vins: [],
    observedVinOrder: [],
    observedVins: new Set(),
    acceptedSources: new Set(accepted.map((row) => row.source)),
    preservedAutorecyclerYards: new Set(),
  };
  for (const row of accepted) {
    if (row.source === "urgiis" && row.nextCursor)
      inventory.preservedUrgiisYards = urgiisPublication(
        parseDurableSourceCursor("urgiis", row.nextCursor),
      ).preservedYards;
    if (row.source === "autorecycler" && row.nextCursor) {
      const cursor = parseDurableSourceCursor("autorecycler", row.nextCursor);
      if (cursor.phase === "complete")
        for (const code of cursor.freshness?.preservedYards ?? [])
          inventory.preservedAutorecyclerYards.add(code);
    }
    const snapshot = await loadSourceSnapshot(params.store, row.snapshotChunks);
    for (const [vin, vehicle] of snapshot.vehicles)
      if (!inventory.vehicles.has(vin)) inventory.vehicles.set(vin, vehicle);
    for (const vin of snapshot.observedVins) inventory.observedVins.add(vin);
  }
  inventory.vins = [...inventory.vehicles.keys()].sort();
  inventory.observedVinOrder = [...inventory.observedVins].sort();
  return inventory;
}
