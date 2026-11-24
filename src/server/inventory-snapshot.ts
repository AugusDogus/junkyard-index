import { and, eq, inArray, like, max, notInArray, or, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { z } from "zod";
import { HiddenSources } from "~/lib/hidden-source";
import { MakeInventory, type MakeRollupRow } from "~/lib/make-inventory";
import { VehicleName } from "~/lib/vehicle-name";
import { InventoryRollup } from "~/server/inventory-rollup";
import {
  ingestionProjectorCheckpoint,
  ingestionRun,
  inventorySnapshot,
} from "~/schema";

/** Live vehicles under one raw make spelling. */
export type MakeCount = { make: string; count: number };

/**
 * The stored make and model aggregates, as of one projection. (Yards have
 * their own table, `yard_inventory`, which ingestion maintains.)
 */
export type InventorySnapshot = {
  makeCounts: MakeCount[];
  /** Live vehicles per raw make spelling and source. */
  makeSourceCounts: MakeSourceCount[];
  /** Each make's rollup rows, by make key. */
  makeModels: ReadonlyMap<string, MakeRollupRow[]>;
};

/** Live vehicles under one raw make spelling at one source. */
type MakeSourceCount = { make: string; source: string; count: number };

// Bump when a stored shape changes: deploys then find the new keys missing
// and compute them. Each version reads and writes only its own keys, so the
// build of a new version leaves the old one's rows to the deployment still
// serving them. Once the new version is live, its ingestion-pass projection
// retires older versions' rows and checkpoints; a deployment rolled back to
// one of them finds its checkpoint gone and projects again on its next pass.
// v3 regroups the source make aliases introduced with search schema 11.
// v4 keeps hidden sources in the stored rows and adds per-source make counts,
// so reads leave hidden sources out and a hide or show applies at once.
const SNAPSHOT_VERSION_NUMBER = 4;
const SNAPSHOT_VERSION = `v${SNAPSHOT_VERSION_NUMBER}`;
const CHECKPOINT_PREFIX = "inventory-snapshot:";
// The publication this version's snapshot reflects, written with its rows.
const CHECKPOINT_NAME = `${CHECKPOINT_PREFIX}${SNAPSHOT_VERSION}`;
// Totals with every source, the shape `modelUrls` reads across versions.
const MAKE_COUNTS_KEY = `${SNAPSHOT_VERSION}:make-counts`;
const MAKE_SOURCE_COUNTS_KEY = `${SNAPSHOT_VERSION}:make-source-counts`;
function makeModelsKey(makeKey: string): string {
  return `${SNAPSHOT_VERSION}:make-models:${makeKey}`;
}

const makeCountsSchema: z.ZodType<MakeCount[]> = z.array(
  z.object({ make: z.string(), count: z.number().int() }),
);
// Rows as tuples: the largest makes have thousands, and repeating every
// field name would double their size.
const makeModelsSchema = z.array(
  z.tuple([
    z.string(),
    z.string(),
    z.string(),
    z.string(),
    z.number().int(),
    z.number().int(),
    z.number().int(),
  ]),
);
type MakeModelTuple = z.infer<typeof makeModelsSchema>[number];
// [make, source, count], as tuples for the same reason.
const makeSourceCountsSchema = z.array(
  z.tuple([z.string(), z.string(), z.number().int()]),
);

function toTuple(row: MakeRollupRow): MakeModelTuple {
  return [
    row.source,
    row.code,
    row.make,
    row.model,
    row.count,
    row.minYear,
    row.maxYear,
  ];
}

function fromTuple([
  source,
  code,
  make,
  model,
  count,
  minYear,
  maxYear,
]: MakeModelTuple): MakeRollupRow {
  return { source, code, make, model, count, minYear, maxYear };
}

/** A stored snapshot that pages cannot use. Vehicle data is unaffected. */
export class InventorySnapshotError extends Error {
  readonly _tag = "InventorySnapshotError";

  constructor(
    readonly key: string,
    readonly reason: "missing" | "invalid",
    detail: string,
  ) {
    super(
      reason === "missing"
        ? `Inventory snapshot "${key}" is not in inventory_snapshot, so pages that list inventory cannot render; vehicle data is unaffected. Deploys compute it after migrating. To compute it now, run \`bun run inventory:project\` with this database's TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.`
        : `Inventory snapshot "${key}" does not match the shape this build reads (${detail}), so pages that list inventory cannot render; vehicle data is unaffected. If the stored shape changed, bump SNAPSHOT_VERSION in src/server/inventory-snapshot.ts so deploys recompute it; otherwise recompute it with \`bun run inventory:project --force\`.`,
    );
    this.name = "InventorySnapshotError";
  }
}

async function storedData(
  database: LibSQLDatabase,
  key: string,
): Promise<string | null> {
  const [row] = await database
    .select({ data: inventorySnapshot.data })
    .from(inventorySnapshot)
    .where(eq(inventorySnapshot.key, key));
  return row?.data ?? null;
}

function parse<Data>(key: string, data: string, schema: z.ZodType<Data>): Data {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch (error) {
    throw new InventorySnapshotError(key, "invalid", String(error));
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new InventorySnapshotError(key, "invalid", parsed.error.message);
  }
  return parsed.data;
}

async function read<Data>(
  database: LibSQLDatabase,
  key: string,
  schema: z.ZodType<Data>,
): Promise<Data> {
  const data = await storedData(database, key);
  if (data === null) throw new InventorySnapshotError(key, "missing", "no row");
  return parse(key, data, schema);
}

/** Make and model pages leave out hidden sources. */
function shown<Row extends { source: string }>(
  rows: readonly Row[],
  hidden: HiddenSources,
): Row[] {
  return rows.filter((row) => !HiddenSources.has(hidden, row.source));
}

function addCount<Key>(counts: Map<Key, number>, key: Key, count: number) {
  counts.set(key, (counts.get(key) ?? 0) + count);
}

/**
 * Stores every source, hidden ones included: reads filter with the hidden
 * list of the moment, so showing a source again needs no new projection.
 */
async function compute(database: LibSQLDatabase): Promise<InventorySnapshot> {
  const counts = new Map<string, number>();
  const sourceCounts = new Map<string, Map<string, number>>();
  const makeModels = new Map<string, MakeRollupRow[]>();
  for (const row of await InventoryRollup.models(database)) {
    addCount(counts, row.make, row.count);
    const bySource = sourceCounts.get(row.make) ?? new Map<string, number>();
    addCount(bySource, row.source, row.count);
    sourceCounts.set(row.make, bySource);
    const key = VehicleName.makeKey(row.make);
    if (!key) continue;
    const rows = makeModels.get(key) ?? [];
    rows.push(row);
    makeModels.set(key, rows);
  }
  const makeCounts = [...counts].map(([make, count]) => ({ make, count }));
  const makeSourceCounts = [...sourceCounts].flatMap(([make, bySource]) =>
    [...bySource].map(([source, count]) => ({ make, source, count })),
  );
  return { makeCounts, makeSourceCounts, makeModels };
}

/**
 * What a projection does with older versions' rows: a build keeps them for
 * the deployment still serving them; the live deployment retires them.
 */
export type OlderSnapshotVersions = "keep" | "retire";

// Every version before this one, which the live deployment retires.
const OLDER_VERSIONS = Array.from(
  { length: SNAPSHOT_VERSION_NUMBER },
  (_, version) => `v${version}`,
);

/**
 * Replaces this version's stored snapshot and its checkpoint in one
 * transaction, writing only rows whose data changed. Retiring deletes older
 * versions' rows and checkpoints in the same transaction, after the writes.
 */
async function write(
  database: LibSQLDatabase,
  snapshot: InventorySnapshot,
  publicationSequence: number,
  now: Date,
  olderVersions: OlderSnapshotVersions,
): Promise<void> {
  const rows = [
    {
      key: MAKE_COUNTS_KEY,
      data: JSON.stringify(snapshot.makeCounts),
      updatedAt: now,
    },
    {
      key: MAKE_SOURCE_COUNTS_KEY,
      data: JSON.stringify(
        snapshot.makeSourceCounts.map(({ make, source, count }) => [
          make,
          source,
          count,
        ]),
      ),
      updatedAt: now,
    },
    ...[...snapshot.makeModels].map(([makeKey, rollup]) => ({
      key: makeModelsKey(makeKey),
      data: JSON.stringify(rollup.map(toTuple)),
      updatedAt: now,
    })),
  ];
  await database.batch([
    // This version's makes that left inventory.
    database.delete(inventorySnapshot).where(
      and(
        like(inventorySnapshot.key, `${SNAPSHOT_VERSION}:%`),
        notInArray(
          inventorySnapshot.key,
          rows.map((row) => row.key),
        ),
      ),
    ),
    database
      .insert(inventorySnapshot)
      .values(rows)
      .onConflictDoUpdate({
        target: inventorySnapshot.key,
        set: {
          data: sql`excluded.data`,
          updatedAt: sql`excluded.updated_at`,
        },
        setWhere: sql`${inventorySnapshot.data} is not excluded.data`,
      }),
    database
      .insert(ingestionProjectorCheckpoint)
      .values({
        name: CHECKPOINT_NAME,
        lastProcessedChangeId: publicationSequence,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: ingestionProjectorCheckpoint.name,
        set: { lastProcessedChangeId: publicationSequence, updatedAt: now },
        setWhere: sql`${ingestionProjectorCheckpoint.lastProcessedChangeId} < ${publicationSequence}`,
      }),
    ...(olderVersions === "retire"
      ? [
          database
            .delete(inventorySnapshot)
            .where(
              or(
                ...OLDER_VERSIONS.map((version) =>
                  like(inventorySnapshot.key, `${version}:%`),
                ),
              ),
            ),
          database.delete(ingestionProjectorCheckpoint).where(
            inArray(
              ingestionProjectorCheckpoint.name,
              OLDER_VERSIONS.map((version) => `${CHECKPOINT_PREFIX}${version}`),
            ),
          ),
        ]
      : []),
  ]);
}

/**
 * Computes the aggregates from live inventory and stores them, recording the
 * latest publication as of the start: the vehicles read include at least it.
 * Older versions' rows are kept unless the caller is the live deployment.
 */
async function project(
  database: LibSQLDatabase,
  now: Date,
  options: { olderVersions: OlderSnapshotVersions } = { olderVersions: "keep" },
): Promise<void> {
  const [latest] = await database
    .select({ sequence: max(ingestionRun.publicationSequence) })
    .from(ingestionRun);
  const snapshot = await compute(database);
  await write(
    database,
    snapshot,
    latest?.sequence ?? 0,
    now,
    options.olderVersions,
  );
}

export const InventorySnapshot = {
  project,

  /** Preferred URLs in every retained snapshot, including older serving builds. */
  async modelUrls(
    database: LibSQLDatabase,
    source: "current" | "retained" = "current",
  ): Promise<string[]> {
    const rows = await database
      .select()
      .from(inventorySnapshot)
      .where(
        like(
          inventorySnapshot.key,
          source === "retained" ? "%:make-%" : `${SNAPSHOT_VERSION}:make-%`,
        ),
      );
    const byKey = new Map(rows.map((row) => [row.key, row.data]));
    const paths = new Set<string>();
    for (const row of rows) {
      if (!row.key.endsWith(":make-counts")) continue;
      const version = row.key.slice(0, -":make-counts".length);
      for (const make of MakeInventory.makes(
        parse(row.key, row.data, makeCountsSchema),
      )) {
        paths.add(make.href);
        const key = `${version}:make-models:${make.key}`;
        const data = byKey.get(key);
        if (data === undefined) continue;
        const models = MakeInventory.models(
          make,
          parse(key, data, makeModelsSchema).map(fromTuple),
        );
        for (const model of models) paths.add(model.href);
      }
    }
    return [...paths];
  },

  /** The publication the stored snapshot reflects; 0 before the first. */
  async projectedThrough(database: LibSQLDatabase): Promise<number> {
    const [row] = await database
      .select({ sequence: ingestionProjectorCheckpoint.lastProcessedChangeId })
      .from(ingestionProjectorCheckpoint)
      .where(eq(ingestionProjectorCheckpoint.name, CHECKPOINT_NAME));
    return row?.sequence ?? 0;
  },

  /**
   * Projects only when this version's snapshot is missing, as on a first
   * deploy or after a shape change. Otherwise the ingestion pass keeps it
   * current, and a deploy need not read every vehicle again.
   */
  async ensure(
    database: LibSQLDatabase,
    now: Date,
  ): Promise<"current" | "projected"> {
    // Each make's rows are written with the make counts, in one transaction.
    if ((await storedData(database, MAKE_COUNTS_KEY)) !== null) {
      return "current";
    }
    await project(database, now);
    return "projected";
  },

  /**
   * Live vehicles per raw make spelling, leaving out hidden sources. The
   * hidden list is applied here, so a hide or show needs no new projection.
   */
  async makeCounts(
    database: LibSQLDatabase,
    hidden: HiddenSources,
  ): Promise<MakeCount[]> {
    const rows = await read(
      database,
      MAKE_SOURCE_COUNTS_KEY,
      makeSourceCountsSchema,
    );
    const counts = new Map<string, number>();
    for (const { make, count } of shown(
      rows.map(([make, source, count]) => ({ make, source, count })),
      hidden,
    ))
      addCount(counts, make, count);
    return [...counts].map(([make, count]) => ({ make, count }));
  },

  /**
   * One make's live vehicles per yard and raw spelling. A make with no live
   * vehicles has no row, so it has none; a cached make list can briefly still
   * name it. Hidden sources are left out at read time, so a hide or show
   * applies at once.
   */
  async makeModels(
    database: LibSQLDatabase,
    makeKey: string,
    hidden: HiddenSources,
  ): Promise<MakeRollupRow[]> {
    const key = makeModelsKey(makeKey);
    const data = await storedData(database, key);
    return data === null
      ? []
      : shown(parse(key, data, makeModelsSchema).map(fromTuple), hidden);
  },
} as const;
