import { streamAlsautoInventoryFromProvider } from "./alsauto-connector";
import { streamBigdInventory } from "./bigd-connector";
import { streamHarrysInventory } from "./harrys-connector";
import { streamBudgetInventory } from "./budget-connector";
import { streamHeavytruckpartsInventory } from "./heavytruckparts-connector";
import { streamVinplusInventory } from "./vinplus-connector";
import { streamUrgiisInventoryFromProvider } from "./urgiis-connector";
import { streamCstruckInventory } from "./cstruck-connector";
import { streamByotInventoryFromProvider } from "./byot-connector";
import {
  loadByotFailedAttemptCursor,
  loadByotPublishedCursor,
} from "./byot-history";
import { loadPublishedSourceCursor } from "./published-source-cursor";
import { loadUrgiisPublishedCursor } from "./urgiis-history";
import { db } from "~/lib/db";
import { streamAlliedInventoryFromProvider } from "./allied-connector";
import { ALLIED_CONTRACT } from "./allied-configuration";
import type { Yard } from "~/lib/yard";
import type { OnYards } from "./yard-metadata";
import { Effect } from "effect";
import { streamWrenchApartInventory } from "./wrenchapart-connector";
import { streamUpullRPartsInventory } from "./upullrparts-connector";
import { streamIPullUPullInventory } from "./ipullupull-connector";
import { streamUpullitwaInventory } from "./upullitwa-connector";
import { streamPartsGaloreInventory } from "./partsgalore-connector";
import { streamRtpInventory } from "./rtp-connector";
import { streamNvpapInventory } from "./nvpap-connector";
import { streamPontiacInventory } from "./pontiac-connector";
import { streamVanderHaagsInventory } from "./vanderhaags-connector";
import { loadVanderHaagsPublishedCursor } from "./vanderhaags-history";
import { streamAeroInventory } from "./aero-connector";
import { streamChesterfieldInventory } from "./chesterfield-connector";
import { streamUtpapInventory } from "./utpap-connector";
import { streamTritownInventory } from "./tritown-connector";
import { streamWhitebradstreetInventory } from "./whitebradstreet-connector";
import { streamMidwayInventory } from "./midway-connector";
import { streamRightwayInventory } from "./rightway-connector";
import { streamDdautoInventory } from "./ddauto-connector";
import { streamRivervalleyInventory } from "./rivervalley-connector";
import { streamFenixInventory } from "./fenix-connector";
import { streamImportapartInventory } from "./importapart-connector";
import { streamBigtruckpageInventory } from "./bigtruckpage-connector";
import { streamSpeedysInventory } from "./speedys-connector";
import { streamArmyInventory } from "./army-connector";
import { streamIdipullInventory } from "./idipull-connector";
import { streamPullsavewaInventory } from "./pullsavewa-connector";
import { streamLittletonInventory } from "./littleton-connector";
import { streamMichigantruckInventory } from "./michigantruck-connector";
import { streamJolietInventory } from "./joliet-connector";
import {
  streamAlln1Inventory,
  streamGrandpajohnsInventory,
} from "./alln1-connector";
import { streamPickersCoverage } from "./pickers-coverage-connector";
import { streamPipesInventory } from "./pipes-connector";
import { streamUwrenchInventory } from "./uwrench-connector";
import { streamMillerstownInventory } from "./millerstown-connector";
import { streamPickapartvaInventory } from "./pickapartva-connector";
import { streamMccauleyInventory } from "./mccauley-connector";
import { streamRustyhookInventory } from "./rustyhook-connector";
import { streamAviationInventory } from "./aviation-connector";
import { streamChazInventory } from "./chaz-connector";
import { streamCitymotorsInventory } from "./citymotors-connector";
import { streamAwapInventory } from "./awap-connector";
import { streamClearsalvageInventory } from "./clearsalvage-connector";
import { streamAplusInventory } from "./aplus-connector";
import { streamCentralInventory } from "./central-connector";
import { streamNorthwestInventory } from "./northwest-connector";
import { streamCoutuInventory } from "./coutu-connector";
import { streamKodakInventory } from "./kodak-connector";
import { streamSix03Inventory } from "./six03-connector";
import { streamRohnerInventory } from "./rohner-connector";
import { streamPrattInventoryFromProvider } from "./pratt-connector";
import { PRATT_CONTRACT } from "./pratt-configuration";
import { streamCars4PartsInventoryFromProvider } from "./cars4parts-connector";
import { CARS4PARTS_CONTRACT } from "./cars4parts-configuration";
import { streamMeeksInventory } from "./meeks-connector";
import { streamBrandywineInventory } from "./brandywine-connector";
import { streamRmmdtpInventoryFromProvider } from "./rmmdtp-connector";
import { RMMDTP_CONTRACT } from "./rmmdtp-configuration";
import { streamCaltonInventoryFromProvider } from "./calton-connector";
import { streamSandwInventoryFromProvider } from "./sandw-connector";
import { streamBeaversInventory } from "./beavers-connector";
import { streamIndianriverInventoryFromProvider } from "./indianriver-connector";
import { streamDentonInventoryFromProvider } from "./denton-connector";
import { streamScottsInventory } from "./scotts-connector";
import { streamDutchersInventory } from "./dutchers-connector";
import { streamChasencarsInventoryFromProvider } from "./chasencars-connector";
import { streamWeberbrothersInventory } from "./weberbrothers-connector";
import { streamHawaiipartsInventory } from "./hawaiiparts-connector";
import { streamModernmuscleInventory } from "./modernmuscle-connector";
import { streamCarsandpartsInventory } from "./carsandparts-connector";
import { streamSpartanInventory } from "./spartan-connector";
import { streamOemgarageInventoryFromProvider } from "./oemgarage-connector";
import { streamHagermanInventory } from "./hagerman-connector";
import { streamKandrInventoryFromProvider } from "./kandr-connector";
import { KANDR_CONTRACT } from "./kandr-configuration";
import { KANDR_YARD } from "./kandr-snapshot";
import { streamJimsimportInventoryFromProvider } from "./jimsimport-connector";
import { streamLonestarimportsInventoryFromProvider } from "./lonestarimports-connector";
import { streamHollanderstoresDurableInventory } from "./hollanderstores-durable";
import { streamHollanderstoresInventoryFromProvider } from "./hollanderstores-provider";
import { streamAlshnedInventory } from "./alshned-connector";
import { streamOemInventoryFromProvider } from "./oem-connector";
import { OEM_LOCATION, OEM_YARD } from "./oem-yard-metadata";
import { SourceValidationPolicy } from "./source-validation";
import { CALTON_CONTRACT, CALTON_YARD } from "./calton-configuration";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import { DonorPhotoStore } from "./donor-photo-store";
import { env } from "~/env";
import {
  connectorChunkMetrics,
  type ConnectorChunkResult,
} from "./connector-chunk";
import { streamAutorecyclerInventory } from "./autorecycler-connector";
import { streamGopullitInventory } from "./gopullit-connector";
import type { FetchedDurableSourceChunk } from "./durable-ingestion-types";
import {
  getDurableSourceDefinition,
  type DurableCursorFor,
  type DurableIngestionSource,
} from "./durable-source";
import { streamPullNSaveInventory } from "./pullnsave-connector";
import { loadCachedPullNSaveYards } from "./pullnsave-yard-directory";
import { Database } from "./context";
import { PersistenceError } from "./errors";
import { streamPullapartInventory } from "./pullapart-connector";
import { loadPullapartCachedEnrichments } from "./pullapart-enrichment-cache";
import { streamPypInventory } from "./pyp-connector";
import { streamRow52Inventory } from "./row52-connector";
import { loadConfiguredRow52YardExclusionIds } from "./row52-yard-exclusion";
import { runIngestionEffect } from "./runtime";
import { TEARAPART_SITE_CONFIG } from "./tap-sites";
import {
  streamTapInventory,
  streamTapSiteInventory,
} from "./tap-inventory-connector";
import { streamUpullitDavieInventory } from "./upullit-davie-connector";
import type { CanonicalVehicle } from "./types";
import { YardCheckPolicy } from "./yard-check-policy";

type OnVehicleBatch = (
  vehicles: CanonicalVehicle[],
) => Effect.Effect<void, never, never>;

interface FetchContext {
  maxPages: number;
  onBatch: OnVehicleBatch;
  onYards: OnYards;
  yardsByCode: Map<string, Yard>;
  vehiclesByVin: Map<string, CanonicalVehicle>;
}

type DurableSourceFetcher<Source extends DurableIngestionSource> = (
  cursor: DurableCursorFor<Source>,
  context: FetchContext,
) => Promise<FetchedDurableSourceChunk<Source>>;

type DurableSourceFetcherRegistry = {
  [Source in DurableIngestionSource]: DurableSourceFetcher<Source>;
};

function toFetchedChunk<Source extends DurableIngestionSource, Cursor>(
  result: Omit<ConnectorChunkResult<Source, Cursor>, "source">,
  toCursor: (cursor: Cursor) => DurableCursorFor<Source>,
  vehiclesByVin: Map<string, CanonicalVehicle>,
  yardsByCode: Map<string, Yard>,
): FetchedDurableSourceChunk<Source> {
  return {
    cursor: toCursor(result.cursor),
    status: result.status,
    pagesProcessed: result.pagesProcessed,
    ...connectorChunkMetrics(result, vehiclesByVin.size),
    errors: result.errors,
    vehicles: [...vehiclesByVin.values()],
    yards: [...yardsByCode.values()],
    observedVins: result.observedVins ?? [],
    yardChecks: result.yardChecks,
    checkpointState: result.checkpointState,
    restart: result.restart,
    failureKind: result.failureKind,
  };
}

const DURABLE_SOURCE_FETCHERS: DurableSourceFetcherRegistry = {
  hollanderstores: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamHollanderstoresDurableInventory(
          {
            loadState: async (path) =>
              (
                await IngestionSnapshotStore.vercelBlob(
                  env.BLOB_READ_WRITE_TOKEN,
                ).load(path)
              ).checkpointState,
            startCursor: cursor,
            maxPages: context.maxPages,
            previousAcceptedCount: null,
            onBatch: context.onBatch,
            onYards: context.onYards,
          },
          streamHollanderstoresInventoryFromProvider,
        ),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  lonestarimports: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamLonestarimportsInventoryFromProvider({
          startCursor: cursor,
          maxPages: context.maxPages,
          // Shared validation compares the prior published complete count.
          previousAcceptedCount: null,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  heavytruckparts: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamHeavytruckpartsInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          // Shared validation compares the prior published complete count.
          previousAcceptedCount: null,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  cstruck: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamCstruckInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          // Shared validation compares the prior published complete count.
          previousAcceptedCount: null,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  alshned: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamAlshnedInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          // Shared validation compares the prior published complete count.
          previousAcceptedCount: null,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  jimsimport: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamJimsimportInventoryFromProvider({
          startCursor: cursor,
          previousCursor:
            cursor.phase !== "complete" && cursor.day === null
              ? await loadPublishedSourceCursor(db, "jimsimport")
              : null,
          maxPages: context.maxPages,
          // Shared validation compares the prior published complete count.
          previousUniqueInventory: null,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              for (const warning of result.warnings) console.warn(warning);
            }),
          ),
        ),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  kandr: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamKandrInventoryFromProvider({
          contract: KANDR_CONTRACT,
          startCursor: cursor,
          maxPages: context.maxPages,
          // Shared validation compares the prior published complete count.
          previousUniqueInventory: null,
          onBatch: context.onBatch,
        }).pipe(
          Effect.tap((result) =>
            result.status === "complete" && result.count > 0
              ? context.onYards([KANDR_YARD])
              : Effect.void,
          ),
        ),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  hagerman: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamHagermanInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          // Shared validation compares the prior published complete count.
          previousAcceptedCount: null,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  hawaiiparts: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamHawaiipartsInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          previousUniqueInventory: null,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  modernmuscle: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamModernmuscleInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          previousUniqueInventory: null,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  carsandparts: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamCarsandpartsInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          previousUniqueInventory: null,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  spartan: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamSpartanInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          previousUniqueInventory: null,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  oemgarage: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamOemgarageInventoryFromProvider({
          startCursor: cursor,
          maxPages: context.maxPages,
          // Durable validation compares the prior published complete count.
          previousUniqueInventory: null,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  weberbrothers: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamWeberbrothersInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          minimumUniqueInventory:
            SourceValidationPolicy.minimumUniqueInventory.weberbrothers,
          // Durable validation compares the prior published complete count.
          previousUniqueInventory: null,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  alsauto: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamAlsautoInventoryFromProvider({
          // Durable validation checks the prior published count before reconciliation.
          previousAcceptedCount: null,
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  chasencars: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamChasencarsInventoryFromProvider({
          // Durable validation checks the prior published count before reconciliation.
          previousAcceptedCount: null,
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  dutchers: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamDutchersInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  oem: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamOemInventoryFromProvider({
          location: OEM_LOCATION,
          minimumUniqueInventory:
            SourceValidationPolicy.minimumUniqueInventory.oem,
          // Durable validation checks previous published inventory before reconciliation.
          previousUniqueInventory: null,
          startCursor: cursor,
          previousCursor:
            cursor.state.phase === "arrivals" && cursor.state.day === null
              ? await loadPublishedSourceCursor(db, "oem")
              : null,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              for (const warning of result.warnings) console.warn(warning);
            }),
          ),
          Effect.tap((result) =>
            result.status === "complete" && result.count > 0
              ? context.onYards([OEM_YARD])
              : Effect.void,
          ),
        ),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  scotts: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamScottsInventory({
          startCursor: cursor,
          previousCursor:
            cursor.phase !== "complete" && cursor.day === null
              ? await loadPublishedSourceCursor(db, "scotts")
              : null,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              for (const warning of result.warnings) console.warn(warning);
            }),
          ),
        ),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  harrys: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamHarrysInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  budget: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamBudgetInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  indianriver: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamIndianriverInventoryFromProvider({
          // Durable validation checks the previous published count before reconciliation.
          previousUniqueInventory: null,
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              for (const warning of result.warnings) console.warn(warning);
            }),
          ),
        ),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  denton: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamDentonInventoryFromProvider({
          // Durable validation checks the previous published count before reconciliation.
          previousAcceptedCount: null,
          startCursor: cursor,
          previousCursor:
            cursor.phase !== "complete" && cursor.day === null
              ? await loadPublishedSourceCursor(db, "denton")
              : null,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              for (const warning of result.warnings) console.warn(warning);
            }),
          ),
        ),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  beavers: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamBeaversInventory({
          // Durable validation checks the previous published count before reconciliation.
          previousAcceptedCount: null,
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  sandw: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamSandwInventoryFromProvider({
          // Durable validation checks the previous published count before reconciliation.
          previousUniqueInventory: null,
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              for (const warning of result.warnings) console.warn(warning);
            }),
          ),
        ),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  calton: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamCaltonInventoryFromProvider({
          contract: CALTON_CONTRACT,
          // Durable validation checks the previous published count before reconciliation.
          previousUniqueInventory: null,
          startCursor: cursor,
          previousCursor:
            cursor.phase !== "complete" && cursor.day === null
              ? await loadPublishedSourceCursor(db, "calton")
              : null,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              for (const warning of result.warnings) console.warn(warning);
            }),
          ),
          Effect.tap((result) =>
            result.status === "complete"
              ? context.onYards([CALTON_YARD])
              : Effect.void,
          ),
        ),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  rmmdtp: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamRmmdtpInventoryFromProvider({
          contract: RMMDTP_CONTRACT,
          // Durable validation checks the previous published count before reconciliation.
          previousUniqueInventory: null,
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  brandywine: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamBrandywineInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  cars4parts: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamCars4PartsInventoryFromProvider({
          contract: CARS4PARTS_CONTRACT,
          // Durable validation checks source history and persisted per-yard drift
          // before allowing reconciliation. Standalone callers supply counts.
          previousUniqueInventory: { heyworth: null, armington: null },
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  meeks: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamMeeksInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  byot: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamByotInventoryFromProvider({
          startCursor: cursor,
          previousCursor:
            cursor.phase === "initial"
              ? await loadByotPublishedCursor(db)
              : null,
          failedAttemptCursor:
            cursor.phase === "initial"
              ? await loadByotFailedAttemptCursor(db, Date.now())
              : null,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  vinplus: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamVinplusInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              for (const warning of result.warnings ?? [])
                console.warn(warning);
            }),
          ),
        ),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  urgiis: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamUrgiisInventoryFromProvider({
          startCursor: cursor,
          previousCursor:
            cursor.startedAt === null
              ? await loadUrgiisPublishedCursor(db)
              : null,
          loadCensus: async (path) =>
            (
              await IngestionSnapshotStore.vercelBlob(
                env.BLOB_READ_WRITE_TOKEN,
              ).load(path)
            ).checkpointState,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              for (const warning of result.warnings) console.warn(warning);
            }),
          ),
        ),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  allied: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamAlliedInventoryFromProvider({
          contract: ALLIED_CONTRACT,
          // Durable source validation checks the previous published count.
          previousUniqueInventory: null,
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              for (const warning of result.warnings) console.warn(warning);
            }),
          ),
        ),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  pratt: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamPrattInventoryFromProvider({
          contract: PRATT_CONTRACT,
          // Durable source validation checks the previous published count.
          previousUniqueInventory: null,
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  rohner: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamRohnerInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  kodak: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamKodakInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  six03: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamSix03Inventory({
          startCursor: cursor,
          previousCursor:
            cursor.phase !== "complete" && cursor.day === null
              ? await loadPublishedSourceCursor(db, "six03")
              : null,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              for (const warning of result.warnings) console.warn(warning);
            }),
          ),
        ),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  central: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamCentralInventory({
          startCursor: cursor,
          previousCursor:
            cursor.phase !== "complete" && cursor.day === null
              ? await loadPublishedSourceCursor(db, "central")
              : null,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              for (const warning of result.warnings) console.warn(warning);
            }),
          ),
        ),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  northwest: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamNorthwestInventory({
          startCursor: cursor,
          previousCursor:
            cursor.phase !== "complete" && cursor.day === null
              ? await loadPublishedSourceCursor(db, "northwest")
              : null,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              for (const warning of result.warnings) console.warn(warning);
            }),
          ),
        ),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  coutu: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamCoutuInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  aplus: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamAplusInventory({
          startCursor: cursor,
          previousCursor:
            cursor.phase !== "complete" && cursor.day === null
              ? await loadPublishedSourceCursor(db, "aplus")
              : null,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              for (const warning of result.warnings) console.warn(warning);
            }),
          ),
        ),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  clearsalvage: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamClearsalvageInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  awap: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamAwapInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  citymotors: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamCitymotorsInventory({
          startCursor: cursor,
          previousCursor:
            cursor.phase !== "complete" && cursor.day === null
              ? await loadPublishedSourceCursor(db, "citymotors")
              : null,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  chaz: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamChazInventory({
          startCursor: cursor,
          previousCursor:
            cursor.phase !== "complete" && cursor.day === null
              ? await loadPublishedSourceCursor(db, "chaz")
              : null,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              for (const warning of result.warnings) console.warn(warning);
            }),
          ),
        ),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  aviation: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamAviationInventory({
          startCursor: cursor,
          previousCursor:
            cursor.phase !== "complete" && cursor.day === null
              ? await loadPublishedSourceCursor(db, "aviation")
              : null,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              for (const warning of result.warnings) console.warn(warning);
            }),
          ),
        ),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  rustyhook: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamRustyhookInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  mccauley: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamMccauleyInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  pickapartva: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamPickapartvaInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  millerstown: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamMillerstownInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  uwrench: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamUwrenchInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  pickers: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamPickersCoverage({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  pipes: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamPipesInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              for (const warning of result.warnings ?? [])
                console.warn(warning);
            }),
          ),
        ),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  alln1: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamAlln1Inventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  grandpajohns: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamGrandpajohnsInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  joliet: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamJolietInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  michigantruck: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamMichigantruckInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  littleton: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamLittletonInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  idipull: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamIdipullInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  bigd: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamBigdInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  pullsavewa: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamPullsavewaInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  fenix: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamFenixInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  bigtruckpage: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamBigtruckpageInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  speedys: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamSpeedysInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  importapart: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamImportapartInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  army: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamArmyInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  tritown: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamTritownInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  whitebradstreet: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamWhitebradstreetInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  midway: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamMidwayInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  rightway: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamRightwayInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  ddauto: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamDdautoInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  rivervalley: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamRivervalleyInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  utpap: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamUtpapInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
          photoStore: DonorPhotoStore.vercelBlob(env.BLOB_READ_WRITE_TOKEN),
          appOrigin: env.NEXT_PUBLIC_APP_URL,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  chesterfield: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamChesterfieldInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
          photoStore: DonorPhotoStore.vercelBlob(env.BLOB_READ_WRITE_TOKEN),
          appUrl: env.NEXT_PUBLIC_APP_URL,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  vanderhaags: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamVanderHaagsInventory({
          startCursor: cursor,
          previousCursor:
            cursor.phase === "start"
              ? await loadVanderHaagsPublishedCursor(db)
              : null,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  aero: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamAeroInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  pontiac: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamPontiacInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  nvpap: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamNvpapInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              // Names each withheld contradictory row.
              for (const warning of result.warnings) console.warn(warning);
            }),
          ),
        ),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  rtp: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamRtpInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  ipullupull: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamIPullUPullInventory({
          startCursor: cursor.catalog,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (catalog) => ({ source: "ipullupull", catalog }),
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  upullitwa: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamUpullitwaInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  partsgalore: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamPartsGaloreInventory({
          startCursor: cursor.catalog,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (catalog) => ({ source: "partsgalore", catalog }),
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  wrenchapart: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamWrenchApartInventory({
          startCursor: cursor,
          maxPages: context.maxPages,
          onBatch: context.onBatch,
          onYards: context.onYards,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  upullrparts: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamUpullRPartsInventory({
          startCursor: cursor,
          onBatch: context.onBatch,
          onYards: context.onYards,
          loadState: async (path) =>
            (
              await IngestionSnapshotStore.vercelBlob(
                env.BLOB_READ_WRITE_TOKEN,
              ).load(path)
            ).checkpointState,
        }),
      ),
      (next) => next,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  pyp: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamPypInventory({
          onBatch: context.onBatch,
          onYards: context.onYards,
          cursor,
          maxPages: context.maxPages,
        }).pipe(Effect.scoped),
      ),
      (nextCursor) => nextCursor,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  row52: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        loadConfiguredRow52YardExclusionIds().pipe(
          Effect.flatMap((excludedLocationIds) =>
            streamRow52Inventory({
              onBatch: context.onBatch,
              onYards: context.onYards,
              cursor,
              excludedLocationIds,
              maxPages: context.maxPages,
            }),
          ),
          Effect.scoped,
        ),
      ),
      (nextCursor) => nextCursor,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  autorecycler: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamAutorecyclerInventory({
          loadArioState: async (path) =>
            (
              await IngestionSnapshotStore.vercelBlob(
                env.BLOB_READ_WRITE_TOKEN,
              ).load(path)
            ).checkpointState,
          onBatch: context.onBatch,
          onYards: context.onYards,
          startCursor: cursor,
          maxPages: context.maxPages,
        }).pipe(Effect.scoped),
      ),
      (nextCursor) => nextCursor,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  pullapart: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamPullapartInventory({
          onBatch: context.onBatch,
          onYards: context.onYards,
          loadCachedEnrichments: loadPullapartCachedEnrichments,
          startAfter: cursor,
          maxPages: context.maxPages,
        }).pipe(Effect.scoped),
      ),
      (nextCursor) => nextCursor,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  upullitne: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamTapInventory({
          onBatch: context.onBatch,
          onYards: context.onYards,
          startStoreIndex: cursor.storeIndex,
          maxPages: context.maxPages,
        }).pipe(Effect.scoped),
      ),
      (storeIndex) => ({ source: "upullitne", storeIndex }),
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  upullitdavie: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamUpullitDavieInventory({
          onBatch: context.onBatch,
          onYards: context.onYards,
          startCursor: cursor,
          maxPages: context.maxPages,
        }),
      ),
      (nextCursor) => ({ source: "upullitdavie", ...nextCursor }),
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  gopullit: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamGopullitInventory({
          onBatch: context.onBatch,
          onYards: context.onYards,
          startCursor: cursor,
          maxPages: context.maxPages,
        }),
      ),
      (nextCursor) => ({ source: "gopullit", ...nextCursor }),
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  pullnsave: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        Effect.gen(function* () {
          const database = yield* Database;
          const cachedYards = yield* Effect.tryPromise({
            try: () => loadCachedPullNSaveYards(database),
            catch: (cause) =>
              new PersistenceError({
                operation: "pullnsave.yards.load",
                cause,
              }),
          });
          return yield* streamPullNSaveInventory({
            cachedYards,
            onBatch: context.onBatch,
            onYards: context.onYards,
            startCursor: cursor.page,
            maxPages: context.maxPages,
          });
        }),
      ),
      (page) => ({ source: "pullnsave", page }),
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  tearapart: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamTapSiteInventory({
          config: TEARAPART_SITE_CONFIG,
          onBatch: context.onBatch,
          onYards: context.onYards,
          startStoreIndex: cursor.storeIndex,
          maxPages: context.maxPages,
        }).pipe(Effect.scoped),
      ),
      (storeIndex) => ({ source: "tearapart", storeIndex }),
      context.vehiclesByVin,
      context.yardsByCode,
    ),
};

function getDurableSourceFetcher<Source extends DurableIngestionSource>(
  source: Source,
): DurableSourceFetcher<Source> {
  return DURABLE_SOURCE_FETCHERS[source];
}

export async function fetchDurableSourceChunk<
  Source extends DurableIngestionSource,
>(
  cursor: DurableCursorFor<Source>,
): Promise<FetchedDurableSourceChunk<Source>> {
  const vehiclesByVin = new Map<string, CanonicalVehicle>();
  const yardsByCode = new Map<string, Yard>();
  const onYards: OnYards = (yards) =>
    Effect.sync(() => {
      for (const yard of yards) yardsByCode.set(yard.code, yard);
    });
  const onBatch = (vehicles: CanonicalVehicle[]) =>
    Effect.sync(() => {
      for (const vehicle of vehicles) {
        if (!vehiclesByVin.has(vehicle.vin))
          vehiclesByVin.set(vehicle.vin, vehicle);
      }
    });
  const maxPages = getDurableSourceDefinition(cursor.source).maxPagesPerChunk;
  const fetched = await getDurableSourceFetcher(cursor.source)(cursor, {
    maxPages,
    onBatch,
    onYards,
    yardsByCode,
    vehiclesByVin,
  });
  return {
    ...fetched,
    yardChecks:
      fetched.yardChecks ??
      YardCheckPolicy.chunkReports(cursor.source, fetched.vehicles),
  };
}
