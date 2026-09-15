import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync } from "node:fs";
import { Effect, Schema } from "effect";
import type { Yard } from "~/lib/yard";
import { createDurableIngestionRepository } from "./durable-ingestion-repository";
import {
  createTestClient,
  TEST_SCHEMA,
  makeVehicle,
} from "./durable-ingestion-test-fixtures";
import type { FetchedDurableSourceChunk } from "./durable-ingestion-types";
import type { DurableSourceCursor } from "./durable-source";
import type { CanonicalVehicle } from "./types";
import { parseIPullUPullCsv } from "./ipullupull-client";
import { transformIPullUPullVehicle } from "./ipullupull-transform";
import type { IPullUPullYard } from "./ipullupull-yard-metadata";
import { parseUpullitwaPage } from "./upullitwa-client";
import { transformUpullitwaVehicle } from "./upullitwa-transform";
import { upullitwaYard } from "./upullitwa-yard-metadata";
import { parsePartsGaloreCatalog } from "./partsgalore-parser";
import { transformPartsGaloreVehicle } from "./partsgalore-transform";
import { PARTSGALORE_YARD } from "./partsgalore-yard-metadata";
import { validateDurableSourceRuns } from "./durable-source-validation";
import { PullNSaveVehicleSchema } from "./pullnsave-client";
import { PULLNSAVE_YARDS } from "./pullnsave-config";
import { transformPullNSaveVehicle } from "./pullnsave-transform";
import { TapInventorySearchProductSchema } from "./tap-inventory-client";
import { transformTapInventoryProduct } from "./tap-inventory-transform";
import { TEARAPART_SITE_CONFIG } from "./tap-sites";
import { pullnsaveYard, tapYard } from "./yard-metadata";
import { connectorChunkMetrics } from "./connector-chunk";
import wrenchFixture from "./fixtures/wrenchapart-sample.json";
import upullRPartsFixture from "./fixtures/upullrparts-vehicle.json";
import { WrenchApartVehicleSchema } from "./wrenchapart-client";
import {
  wrenchapartYard,
  wrenchapartPricesUrl,
} from "./wrenchapart-yard-metadata";
import { transformWrenchApartVehicle } from "./wrenchapart-transform";
import { UpullRPartsVehicleSchema } from "./upullrparts-client";
import { findUpullRPartsYard } from "./upullrparts-yard-metadata";
import { transformUpullRPartsVehicle } from "./upullrparts-transform";

describe("provider checkpoints", () => {
  test("checkpoints new provider fixtures and yard metadata atomically without duplicating replays", async () => {
    const pnsRows = Schema.decodeUnknownSync(
      Schema.Array(PullNSaveVehicleSchema),
    )(
      JSON.parse(
        readFileSync(
          new URL("./fixtures/pullnsave-search-page1.json", import.meta.url),
          "utf8",
        ),
      ),
    );
    const tapResponse = Schema.decodeUnknownSync(
      Schema.Struct({
        products: Schema.Array(TapInventorySearchProductSchema),
      }),
    )(
      JSON.parse(
        readFileSync(
          new URL(
            "./fixtures/tap-tearapart-search-salt-lake-city.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    );
    const pnsRecord = pnsRows[0];
    const tapRecord = tapResponse.products[0];
    if (!pnsRecord || !tapRecord)
      throw new Error("Provider fixtures need at least one vehicle");
    const pnsStore = PULLNSAVE_YARDS.find(
      (yard) => yard.yardNumber === pnsRecord.astStoreNumber,
    );
    const tapStore = TEARAPART_SITE_CONFIG.storeLocations["SALT LAKE CITY"];
    if (!pnsStore || !tapStore)
      throw new Error("Provider fixtures need configured yards");
    const pnsVehicle = transformPullNSaveVehicle(pnsRecord, pnsStore);
    const tapVehicle = transformTapInventoryProduct(
      tapRecord,
      tapStore,
      TEARAPART_SITE_CONFIG,
    );
    if (!pnsVehicle || !tapVehicle)
      throw new Error("Provider fixtures need valid canonical vehicles");
    const wrenchYard = wrenchapartYard(wrenchFixture.location);
    if (!wrenchYard || wrenchYard.lat === null || wrenchYard.lng === null)
      throw new Error("Wrench fixture needs a located yard");
    const wrenchVehicle = transformWrenchApartVehicle(
      Schema.decodeUnknownSync(WrenchApartVehicleSchema)(wrenchFixture.vehicle),
      { ...wrenchYard, lat: wrenchYard.lat, lng: wrenchYard.lng },
      wrenchapartPricesUrl(wrenchFixture.location),
    );
    const uprRecord = Schema.decodeUnknownSync(UpullRPartsVehicleSchema)(
      upullRPartsFixture,
    );
    const uprYard = findUpullRPartsYard(uprRecord.Store);
    if (!uprYard)
      throw new Error("U Pull R Parts fixture needs a configured yard");
    const uprVehicle = transformUpullRPartsVehicle(uprRecord, uprYard, {
      status: "resolved",
      make: "Ford",
    });
    if (!wrenchVehicle || !uprVehicle)
      throw new Error("Provider fixtures must produce canonical vehicles");
    const fixtureText = (name: string) =>
      readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
    const ipullRecord = Effect.runSync(
      parseIPullUPullCsv(fixtureText("ipullupull-sample.csv")),
    )[0];
    const waRecord = parseUpullitwaPage(
      fixtureText("upullitwa-page.html"),
      "JJ65",
      1,
    ).records[0];
    const pgRecord = Effect.runSync(
      parsePartsGaloreCatalog(fixtureText("partsgalore-catalog.html")),
    )[0];
    const waYard = upullitwaYard("JJ65");
    const ipullYard: IPullUPullYard = {
      source: "ipullupull",
      code: "IPULLUPULL-FRESNO-CA",
      name: "iPull-uPull - Fresno",
      operator: "iPull-uPull",
      address: "2274 East Muscat Avenue",
      city: "Fresno",
      state: "CA",
      postalCode: "93725",
      lat: 36.68622,
      lng: -119.7486323,
      websiteUrl: "https://ipullupull.com/locations/fresno-ca/",
      phone: "559-445-4117",
      email: null,
    };
    if (!ipullRecord || !waRecord || !pgRecord || !waYard)
      throw new Error("New provider fixtures need usable rows and yards");
    const ipullVehicle = transformIPullUPullVehicle(ipullRecord, ipullYard);
    const waVehicle = transformUpullitwaVehicle(waRecord, waYard);
    const pgVehicle = transformPartsGaloreVehicle(pgRecord, PARTSGALORE_YARD);
    if (!ipullVehicle || !waVehicle || !pgVehicle)
      throw new Error("New provider fixtures must produce canonical vehicles");
    const cases: Array<{
      initial: DurableSourceCursor;
      next: DurableSourceCursor;
      vehicle: CanonicalVehicle;
      yard: Yard;
    }> = [
      {
        initial: { source: "ipullupull", catalog: 0 },
        next: { source: "ipullupull", catalog: 1 },
        vehicle: ipullVehicle,
        yard: ipullYard,
      },
      {
        initial: { source: "partsgalore", catalog: 0 },
        next: { source: "partsgalore", catalog: 1 },
        vehicle: pgVehicle,
        yard: PARTSGALORE_YARD,
      },
      {
        initial: { source: "upullitwa", phase: "start" },
        next: { source: "upullitwa", phase: "complete" },
        vehicle: waVehicle,
        yard: waYard,
      },
      {
        initial: { source: "pullnsave", page: 1 },
        next: { source: "pullnsave", page: 2 },
        vehicle: pnsVehicle,
        yard: pullnsaveYard(pnsStore),
      },
      {
        initial: { source: "tearapart", storeIndex: 0 },
        next: { source: "tearapart", storeIndex: 1 },
        vehicle: tapVehicle,
        yard: tapYard(tapStore, TEARAPART_SITE_CONFIG),
      },
      {
        initial: { source: "upullrparts", catalog: 0 },
        next: { source: "upullrparts", catalog: 1 },
        vehicle: uprVehicle,
        yard: uprYard,
      },
      {
        initial: { source: "wrenchapart", afterLocationId: 0 },
        next: {
          source: "wrenchapart",
          afterLocationId: wrenchFixture.location.id,
        },
        vehicle: wrenchVehicle,
        yard: wrenchYard,
      },
    ];
    const testDatabase = createTestClient();
    try {
      const { client } = testDatabase;
      await client.executeMultiple(TEST_SCHEMA);
      const repository = createDurableIngestionRepository(
        drizzle(client),
        client,
      );
      await repository.initialize("run-new-providers");
      for (const item of cases) {
        const metrics = connectorChunkMetrics(
          {
            count: 1,
            errors: [],
            accounting:
              item.vehicle.source === "pullnsave"
                ? {
                    recordsProcessed: 4,
                    recordsExcluded: 1,
                    recordsRejected: 1,
                    duplicateVehicles: 1,
                  }
                : undefined,
          },
          1,
        );
        const checkpoint = {
          runId: "run-new-providers",
          requestedCursor: item.initial,
          fetched: {
            cursor: item.next,
            status:
              "catalog" in item.next ||
              ("phase" in item.next && item.next.phase === "complete")
                ? "complete"
                : "paused",
            pagesProcessed: 1,
            ...metrics,
            errors: [],
            vehicles: [item.vehicle],
            yards: [item.yard],
          } satisfies FetchedDurableSourceChunk,
        };
        const first = await repository.checkpointChunk(checkpoint);
        const replay = await repository.checkpointChunk(checkpoint);
        expect(first.count).toBe(metrics.vehiclesProcessed);
        expect(replay.count).toBe(metrics.vehiclesProcessed);
        expect(replay.pagesProcessed).toBe(1);
        const persisted = (
          await repository.getSourceRuns("run-new-providers")
        ).find((run) => run.source === item.vehicle.source);
        expect(persisted).toMatchObject(metrics);
      }
      const stored = await client.execute(
        `select s.source, s.vin, y.code, y.operator from vehicle_snapshot s join yard y on y.source = s.source and y.code = s.location_code order by s.source`,
      );
      expect(
        stored.rows.map(({ source, vin, code, operator }) => ({
          source,
          vin,
          code,
          operator,
        })),
      ).toEqual(
        cases
          .map((item) => ({
            source: item.vehicle.source,
            vin: item.vehicle.vin,
            code: item.yard.code,
            operator: item.yard.operator,
          }))
          .sort((a, b) => a.source.localeCompare(b.source)),
      );
    } finally {
      testDatabase.cleanup();
    }
  });
  test("Washington cross-chunk duplicates are counted from persisted snapshots without VINs in its cursor", async () => {
    const testDatabase = createTestClient();
    const { client } = testDatabase;
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const database = drizzle(client);
      const repository = createDurableIngestionRepository(database, client);
      await repository.initialize("run-wa-duplicates");
      const initial = { source: "upullitwa", phase: "start" } as const;
      const page = {
        source: "upullitwa",
        phase: "page",
        yardId: "JJ65",
        page: 2,
        declaredPageCount: 2,
        completedYardIds: [],
        pageFingerprints: ["a".repeat(64)],
        usableYardVehicles: 1,
      } as const;
      const next: DurableSourceCursor = {
        ...page,
        completedYardIds: [],
        pageFingerprints: [...page.pageFingerprints],
      };
      const vehicles: CanonicalVehicle[] = [
        { ...makeVehicle(), source: "upullitwa" },
      ];
      const fetched = {
        cursor: next,
        status: "paused",
        pagesProcessed: 1,
        vehiclesProcessed: 1,
        uniqueVehicles: 1,
        duplicateVehicles: 0,
        rejectedVehicles: 0,
        errors: [],
        vehicles,
        yards: [],
      } satisfies FetchedDurableSourceChunk;
      await repository.checkpointChunk({
        runId: "run-wa-duplicates",
        requestedCursor: initial,
        fetched,
      });
      const terminal: FetchedDurableSourceChunk<"upullitwa"> = {
        ...fetched,
        cursor: { source: "upullitwa", phase: "complete" },
        status: "complete",
      };
      await repository.checkpointChunk({
        runId: "run-wa-duplicates",
        requestedCursor: next,
        fetched: terminal,
      });
      await repository.checkpointChunk({
        runId: "run-wa-duplicates",
        requestedCursor: next,
        fetched: terminal,
      });
      await client.execute(
        "update ingestion_source_run set status = 'failed' where source <> 'upullitwa'",
      );
      await validateDurableSourceRuns({
        runId: "run-wa-duplicates",
        database,
        batchClient: client,
      });
      const stored = (await repository.getSourceRuns("run-wa-duplicates")).find(
        (row) => row.source === "upullitwa",
      );
      expect(stored).toMatchObject({
        vehiclesProcessed: 2,
        uniqueVehicles: 1,
        duplicateVehicles: 1,
        pagesProcessed: 2,
      });
    } finally {
      testDatabase.cleanup();
    }
  });
});
