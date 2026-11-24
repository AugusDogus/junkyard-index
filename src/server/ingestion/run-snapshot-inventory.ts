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
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import { reconciliationSourcePriority } from "./reconciliation-policy";
import type { CanonicalVehicle } from "./types";

export interface SourceSnapshot {
  /** First snapshot of each VIN in checkpoint order. */
  vehicles: Map<string, CanonicalVehicle>;
  observedVins: Set<string>;
}

/**
 * Final run inventory: one vehicle per VIN from its highest-priority source.
 * Read-only because a process reuses it across reconciliation steps.
 */
export interface RunSnapshotInventory {
  readonly vehicles: ReadonlyMap<string, CanonicalVehicle>;
  /** VINs ordered for cursor-based reconciliation batches. */
  readonly vins: readonly string[];
  readonly observedVins: ReadonlySet<string>;
  /** Observations ordered for bounded VIN lookups during missing reconciliation. */
  readonly observedVinOrder: readonly string[];
  readonly acceptedSources: ReadonlySet<IngestionSource>;
  readonly preservedUrgiisYards: ReadonlySet<string>;
  readonly preservedAutorecyclerYards: ReadonlySet<string>;
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
    // Checkpoint state carries no inventory. Chunks staged before it moved to
    // its own blobs still embed it and load whole.
    if (IngestionSnapshotStore.isCheckpointStatePath(pathname)) continue;
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

/**
 * The last inventory built from each store. One run commits at a time, and
 * its next reconciliation step usually runs in the same process, so reusing
 * it skips reloading every chunk: a URG run stages over 1,000 chunks, which
 * takes minutes to load. (Hollander's ~19 MiB census checkpoint now lives in
 * its own blob, which this load skips; a run staged before that embedded it
 * in each of its ~550 chunks.)
 */
const lastInventory = new WeakMap<
  IngestionSnapshotStore,
  { runId: string; key: string; inventory: RunSnapshotInventory }
>();

/** Loads the run's accepted inventory, reusing the process's last load of it. */
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
  // Snapshot chunks are immutable blobs under unique pathnames, so the
  // accepted rows identify the inventory exactly.
  const key = JSON.stringify([params.runId, accepted]);
  const cached = lastInventory.get(params.store);
  if (cached?.key === key) return cached.inventory;
  lastInventory.delete(params.store);

  const vehicles = new Map<string, CanonicalVehicle>();
  const observedVins = new Set<string>();
  let preservedUrgiisYards: ReadonlySet<string> = new Set();
  const preservedAutorecyclerYards = new Set<string>();
  for (const row of accepted) {
    if (row.source === "urgiis" && row.nextCursor)
      preservedUrgiisYards = urgiisPublication(
        parseDurableSourceCursor("urgiis", row.nextCursor),
      ).preservedYards;
    if (row.source === "autorecycler" && row.nextCursor) {
      const cursor = parseDurableSourceCursor("autorecycler", row.nextCursor);
      if (cursor.phase === "complete")
        for (const code of cursor.freshness?.preservedYards ?? [])
          preservedAutorecyclerYards.add(code);
    }
    const snapshot = await loadSourceSnapshot(params.store, row.snapshotChunks);
    for (const [vin, vehicle] of snapshot.vehicles)
      if (!vehicles.has(vin)) vehicles.set(vin, vehicle);
    for (const vin of snapshot.observedVins) observedVins.add(vin);
  }
  const inventory: RunSnapshotInventory = {
    vehicles,
    vins: [...vehicles.keys()].sort(),
    observedVins,
    observedVinOrder: [...observedVins].sort(),
    acceptedSources: new Set(accepted.map((row) => row.source)),
    preservedUrgiisYards,
    preservedAutorecyclerYards,
  };
  lastInventory.set(params.store, { runId: params.runId, key, inventory });
  return inventory;
}

/** Drops a run's reused inventory once its reconciliation stops pausing. */
export function forgetRunSnapshotInventory(
  store: IngestionSnapshotStore,
  runId: string,
) {
  if (lastInventory.get(store)?.runId === runId) lastInventory.delete(store);
}
