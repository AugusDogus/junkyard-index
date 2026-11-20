import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "devalue";
import { z } from "zod";
import { DentonCursor } from "../src/server/ingestion/denton-cursor";
import { dentonHash } from "../src/server/ingestion/denton-traversal";
import { Effect } from "effect";
import { drizzle } from "drizzle-orm/libsql";
import { BrandywineCursor } from "../src/server/ingestion/brandywine-cursor";
import {
  brandywineSavedControls,
  brandywineSavedDetails,
} from "../src/server/ingestion/brandywine-test-fixtures";
import { LonestarimportsCursor } from "../src/server/ingestion/lonestarimports-cursor";
import { lonestarimportsNative } from "../src/server/ingestion/lonestarimports-test-fixtures";
import { streamLonestarimportsInventory } from "../src/server/ingestion/lonestarimports-connector";
import { createDurableIngestionRepository } from "../src/server/ingestion/durable-ingestion-repository";
import {
  createTestClient,
  TEST_SCHEMA,
} from "../src/server/ingestion/durable-ingestion-test-fixtures";
import { IngestionSnapshotStore } from "../src/server/ingestion/ingestion-snapshot-store";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
  type DurableSourceCursor,
} from "../src/server/ingestion/durable-source";
import { URGIIS_TENANTS } from "../src/server/ingestion/urgiis-configuration";
import { UrgiisReplayArchive } from "../src/server/ingestion/urgiis-replay-archive";
import { UrgiisCursor } from "../src/server/ingestion/urgiis-cursor";
import { iisCards, iisDirectory } from "../src/server/ingestion/urgiis-catalog";
import { urgiisDetailSeller } from "../src/server/ingestion/urgiis-detail";
import {
  urgiisFingerprint,
  urgiisTasks,
  type UrgiisEntry,
  type UrgiisTask,
} from "../src/server/ingestion/urgiis-traversal";

// Offline only. Optional qualification evidence root adds the saved Weber,
// OEM and Denton captures. Every reported compact value uses the repository.
const evidenceRoot = process.argv[2];
const rows: {
  source: string;
  evidence: string;
  canonicalBytes: number;
  inputBytes: number;
  resultBytes: number;
  compactInputBytes: number;
  compactResultBytes: number;
}[] = [];
const { client, cleanup } = createTestClient();
try {
  await client.executeMultiple(TEST_SCHEMA);
  const repository = createDurableIngestionRepository(
    drizzle(client),
    client,
    IngestionSnapshotStore.memory(),
  );
  await repository.initialize("offline-payload-report");
  async function measure(cursor: DurableSourceCursor, evidence: string) {
    const wire = serializeDurableSourceCursor(cursor);
    await client.execute({
      sql: "update ingestion_source_run set next_cursor = ? where run_id = 'offline-payload-report' and source = ?",
      args: [wire, cursor.source],
    });
    const compact = await repository.workflowCursor(
      "offline-payload-report",
      cursor,
    );
    const result = {
      cursor,
      status: "paused",
      count: 0,
      errors: [],
      pagesProcessed: 8,
    };
    rows.push({
      source: cursor.source,
      evidence,
      canonicalBytes: Buffer.byteLength(wire),
      inputBytes: Buffer.byteLength(
        stringify(["offline-payload-report", cursor]),
      ),
      resultBytes: Buffer.byteLength(stringify(result)),
      compactInputBytes: Buffer.byteLength(
        stringify(["offline-payload-report", compact]),
      ),
      compactResultBytes: Buffer.byteLength(
        stringify({ ...result, cursor: compact }),
      ),
    });
  }
  await measure(
    BrandywineCursor.checkpoint({
      ...BrandywineCursor.initial(null),
      startedAt: Date.UTC(2026, 10, 17, 7),
      phase: "complete",
      opening: brandywineSavedControls("opening"),
      details: brandywineSavedDetails(),
      closing: brandywineSavedControls("closing"),
    }),
    "full repository census fixture, terminal",
  );
  const bodies = [
    ...lonestarimportsNative.openingDocuments,
    ...lonestarimportsNative.openingPages,
    ...lonestarimportsNative.closingPages,
    ...[...lonestarimportsNative.closingDocuments].reverse(),
  ];
  let reads = 0,
    cursor = LonestarimportsCursor.initial(null),
    largest = cursor;
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      streamLonestarimportsInventory({
        previousAcceptedCount: null,
        startCursor: cursor,
        readPage: () =>
          Effect.sync(() => {
            const body = bodies[reads++];
            if (!body) throw new Error("Offline Lone Star replay exhausted");
            return body;
          }),
        onBatch: () => Effect.void,
      }),
    );
    cursor = result.cursor;
    if (stringify(cursor).length > stringify(largest).length) largest = cursor;
  }
  await measure(
    largest,
    `largest of 33 checkpoints, ${reads} repository response bodies`,
  );
  if (evidenceRoot) {
    for (const [source, file] of [
      ["weberbrothers", "weberbrothers-root-complete-cursor.json"],
      ["oem", "research/oh_mi_wi/refill02/oem-closing-cursor.json"],
      ["denton", "research/ks_ok_nm_tx/denton-live-closing-checkpoint.json"],
    ] as const) {
      let wire = readFileSync(join(evidenceRoot, file), "utf8");
      let evidence = file;
      if (source === "denton") {
        // Historical capture binds an earlier contract hash. For sizing only,
        // rebind its unchanged graph to today's scope, then validate all fields.
        // This report never writes an operational database or provider state.
        const initial = DentonCursor.initial(null);
        if (!initial.ok) throw new Error(initial.error.message);
        const captured = z
          .record(z.string(), z.unknown())
          .parse(JSON.parse(wire));
        const rebound = {
          ...captured,
          scope: initial.value.scope,
          checksum: undefined,
        };
        wire = JSON.stringify({ ...rebound, checksum: dentonHash(rebound) });
        evidence +=
          " (unchanged graph, current scope/hash for offline sizing only)";
      }
      await measure(parseDurableSourceCursor(source, wire), evidence);
    }
  }
  const start = Date.UTC(2026, 10, 17, 7);
  let largestUrg = UrgiisCursor.initial();
  // Reconstruct the largest opening graph from every complete saved tenant
  // replay. Prior-prefix counts use qualified floors, which changes only digits.
  for (const [index, tenant] of URGIIS_TENANTS.entries()) {
    const archive = await UrgiisReplayArchive.open(tenant.code);
    const entries: UrgiisEntry[] = [];
    let details: UrgiisTask[] | null = null;
    try {
      while (true) {
        const tasks: UrgiisTask[] = details ?? urgiisTasks(entries, tenant);
        const task = tasks[entries.length];
        if (!task) break;
        if (task.kind === "detail") details = tasks;
        const response = await archive.next();
        if (!response || response.url !== task.url)
          throw new Error(`Offline graph changed for ${tenant.code}`);
        const receipt = {
          url: task.url,
          bytes: Buffer.byteLength(response.html),
        };
        if (task.kind === "owner")
          entries.push({
            ...receipt,
            kind: "owner",
            identity: urgiisFingerprint(tenant.ownerClaims),
          });
        else if (task.kind === "makes" || task.kind === "menu")
          entries.push({
            ...receipt,
            kind: task.kind,
            controls: iisDirectory(
              response.html,
              tenant,
              task.kind === "menu" ? task.make : undefined,
            ),
          });
        else if (task.kind === "detail")
          entries.push({
            ...receipt,
            kind: "detail",
            seller: urgiisDetailSeller(response.html, tenant, task),
            readAt: start,
          });
        else {
          const records = iisCards(response.html, tenant, task.kind).records;
          entries.push(
            task.kind === "model"
              ? {
                  ...receipt,
                  kind: "model",
                  records,
                  freshness: { kind: "read", readAt: start },
                }
              : { ...receipt, kind: "arrivals", records },
          );
        }
      }
      const closed = urgiisTasks(entries, tenant).filter((task) =>
        ["owner", "makes", "menu"].includes(task.kind),
      ).length;
      const candidate = UrgiisCursor.checkpoint({
        ...UrgiisCursor.initial(),
        startedAt: start,
        asOf: start,
        phase: "ready",
        entries,
        closed,
        requests: entries.length + closed,
        bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
        completed: URGIIS_TENANTS.slice(0, index).map((prior) => ({
          code: prior.code,
          accepted: prior.minimumInventory,
        })),
      });
      if (stringify(candidate).length > stringify(largestUrg).length)
        largestUrg = candidate;
    } finally {
      archive.close();
    }
  }
  await measure(
    largestUrg,
    "largest reconstructed current-tenant graph across all repository replays; prior-prefix counts use floors",
  );
  console.log(JSON.stringify(rows, null, 2));
} finally {
  cleanup();
}
