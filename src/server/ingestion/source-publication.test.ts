import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { ingestionRun, ingestionSourceRun } from "~/schema";
import { TEST_SCHEMA } from "./durable-ingestion-test-fixtures";
import { SourcePublication } from "./source-publication";

async function setup() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(TEST_SCHEMA);
  return { client, database: drizzle(client) };
}

type Database = Awaited<ReturnType<typeof setup>>["database"];

async function addRun(
  database: Database,
  id: string,
  run: {
    status?: "success" | "error";
    acceptance?: "accepted" | "rejected";
    inventoryPublishedAt: number | null;
    searchPublishedAt: number | null;
  },
) {
  await database.insert(ingestionRun).values({
    id,
    source: "pyp",
    status: "success",
    stage: "released",
    startedAt: new Date(0),
    lastProgressAt: new Date(0),
    inventoryPublishedAt:
      run.inventoryPublishedAt === null
        ? null
        : new Date(run.inventoryPublishedAt),
    searchPublishedAt:
      run.searchPublishedAt === null ? null : new Date(run.searchPublishedAt),
  });
  await database.insert(ingestionSourceRun).values({
    id: `${id}:pyp`,
    runId: id,
    source: "pyp",
    status: run.status ?? "success",
    acceptanceStatus: run.acceptance ?? "accepted",
    uniqueVehicles: run.inventoryPublishedAt ?? 0,
    nextCursor: `cursor-${id}`,
    startedAt: new Date(0),
  });
}

describe("SourcePublication", () => {
  test("the newest accepted inventory publication wins even while search has not published it", async () => {
    const { client, database } = await setup();
    try {
      expect(await SourcePublication.latestAccepted(database, "pyp")).toBe(
        null,
      );
      expect(
        await SourcePublication.latestAcceptedCursor(database, "pyp"),
      ).toBe(null);
      await addRun(database, "searched", {
        inventoryPublishedAt: 100,
        searchPublishedAt: 110,
      });
      await addRun(database, "search-skipped", {
        inventoryPublishedAt: 200,
        searchPublishedAt: null,
      });
      await addRun(database, "rejected", {
        acceptance: "rejected",
        inventoryPublishedAt: 300,
        searchPublishedAt: 310,
      });
      await addRun(database, "failed", {
        status: "error",
        inventoryPublishedAt: 400,
        searchPublishedAt: null,
      });
      await addRun(database, "unpublished", {
        inventoryPublishedAt: null,
        searchPublishedAt: null,
      });

      expect(await SourcePublication.latestAccepted(database, "pyp")).toEqual({
        runId: "search-skipped",
        sourceRunId: "search-skipped:pyp",
        publishedAt: new Date(200),
        uniqueVehicles: 200,
      });
      expect(
        await SourcePublication.latestAcceptedCursor(database, "pyp"),
      ).toEqual({ runId: "search-skipped", cursor: "cursor-search-skipped" });
      // Validation compares a run against the publication before it.
      expect(
        await SourcePublication.latestAccepted(database, "pyp", {
          excludeRunId: "search-skipped",
        }),
      ).toMatchObject({ runId: "searched" });
      expect(await SourcePublication.latestAccepted(database, "row52")).toBe(
        null,
      );
    } finally {
      client.close();
    }
  });

  test("the accepted-publication SQL keys on inventory publication", async () => {
    const { client, database } = await setup();
    try {
      await addRun(database, "search-skipped", {
        inventoryPublishedAt: 200,
        searchPublishedAt: null,
      });
      await addRun(database, "search-only", {
        inventoryPublishedAt: null,
        searchPublishedAt: 300,
      });
      const rows = await database
        .select({
          runId: ingestionSourceRun.runId,
          accepted: sql<number>`${SourcePublication.acceptedSql}`,
        })
        .from(ingestionSourceRun)
        .innerJoin(ingestionRun, eq(ingestionRun.id, ingestionSourceRun.runId))
        .orderBy(ingestionSourceRun.runId);
      expect(rows).toEqual([
        { runId: "search-only", accepted: 0 },
        { runId: "search-skipped", accepted: 1 },
      ]);
    } finally {
      client.close();
    }
  });
});
