import { ingestionValidation } from "./ingestion-validation";
import { Effect, RateLimiter } from "effect";
import type { Yard } from "~/lib/yard";
import {
  ChesterfieldProviderError,
  ChesterfieldSession,
} from "./chesterfield-client";
import {
  ChesterfieldCursor,
  ChesterfieldCursorSchema,
  type ChesterfieldSeen,
} from "./chesterfield-cursor";
import { ChesterfieldDonor, chesterfieldYardName } from "./chesterfield-donor";
import {
  chesterfieldDescription,
  chesterfieldDonorKey,
  chesterfieldHash,
  chesterfieldIdentity,
  chesterfieldPageHash,
} from "./chesterfield-evidence";
import { preserveChesterfieldPhoto } from "./chesterfield-photo";
import {
  chesterfieldPhotoOrigin,
  transformChesterfieldDonor,
  type ChesterfieldCanonicalVehicle,
} from "./chesterfield-transform";
import {
  CHESTERFIELD_YARDS,
  parseChesterfieldYards,
} from "./chesterfield-yard-metadata";
import type { ConnectorChunkResult } from "./connector-chunk";
import type { DonorPhotoStore } from "./donor-photo-store";
import type { ProviderRequestGate } from "./provider-http-client";
import { SourceValidationPolicy } from "./source-validation";

interface ChesterfieldOptions<E, R> {
  startCursor?: ChesterfieldCursor;
  maxPages?: number;
  photoStore: DonorPhotoStore;
  appUrl: string;
  onBatch: (
    vehicles: ChesterfieldCanonicalVehicle[],
  ) => Effect.Effect<void, E, R>;
  onYards?: (yards: Yard[]) => Effect.Effect<void, E, R>;
}
export type ChesterfieldStreamResult = ConnectorChunkResult<
  "chesterfield",
  ChesterfieldCursor
>;
const failure = (operation: string, cause: unknown) =>
  new ChesterfieldProviderError({ operation, cause });
const directoryHash = (makes: ChesterfieldSession["makes"]) =>
  chesterfieldHash(makes.slice().sort((a, b) => a.id.localeCompare(b.id)));

function validateCompletion(
  cursor: Extract<ChesterfieldCursor, { phase: "inventory" }>,
) {
  for (const control of cursor.controls) {
    const donor = cursor.seen.find(
      (entry) => chesterfieldDonorKey(entry) === chesterfieldDonorKey(control),
    );
    if (donor?.identity !== control.identity)
      throw new Error(
        "Catalog did not recover newest-car control " +
          chesterfieldDonorKey(control),
      );
  }
  for (const yard of Object.keys(CHESTERFIELD_YARDS)) {
    const donors = cursor.seen.filter((entry) => entry.yard === yard);
    const rejected = donors.filter(
      (entry) => entry.status === "incomplete",
    ).length;
    if (
      donors.length === rejected ||
      rejected / donors.length > SourceValidationPolicy.maximumRejectionRatio
    )
      throw new Error(
        `Per-yard quality failed for ${yard}: ${rejected} rejected of ${donors.length} donors; retain the 10% rejection limit`,
      );
  }
}

export function streamChesterfieldInventoryWithRequestGate<E, R>(
  options: ChesterfieldOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = ChesterfieldCursorSchema.safeParse(
      options.startCursor ?? ChesterfieldCursor.initial,
    );
    const maxPages = options.maxPages ?? 16;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 6 ||
      maxPages > 32
    )
      return yield* failure(
        "checkpoint",
        "Expected a validated cursor and a budget of 6-32 HTTP requests",
      );
    const appOrigin = yield* ingestionValidation({
      try: () => chesterfieldPhotoOrigin(options.appUrl),
      catch: (cause) => failure("photo origin", cause),
    });
    let cursor: ChesterfieldCursor = parsed.data;
    let pagesProcessed = 0;
    let count = 0;
    const observedVins: string[] = [];
    const accounting = {
      recordsProcessed: 0,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    };
    const countedGate: ProviderRequestGate = (request) =>
      Effect.suspend(() => {
        if (pagesProcessed >= maxPages)
          return Effect.die(
            failure(
              "request budget",
              "Unexpected HTTP request beyond the validated chunk bound",
            ),
          );
        pagesProcessed++;
        return gate(request);
      });
    if (cursor.phase !== "complete") {
      const session = yield* ChesterfieldSession.open(countedGate);
      const yards = yield* ingestionValidation({
        try: () => parseChesterfieldYards(session.html),
        catch: (cause) => failure("yard metadata", cause),
      });
      if (options.onYards) yield* options.onYards(yards);
      if (cursor.phase === "start") {
        const records = yield* session.newest();
        if (
          records.some(
            (record) =>
              !/^\d{4}$/.test(record.year) ||
              Number(record.year) < Number(session.lower) ||
              Number(record.year) > Number(session.upper),
          )
        )
          return yield* failure(
            "newest controls",
            "Native newest-car years fall outside the published search bounds; complete traversal is unproven",
          );
        const controls = records.map((record) => ({
          yard: record.yard,
          stock: record.stock,
          identity: chesterfieldIdentity(record),
        }));
        const next = ChesterfieldCursorSchema.safeParse({
          source: "chesterfield",
          phase: "directories",
          lower: session.lower,
          upper: session.upper,
          makes: session.makes,
          controls,
          queries: [],
          index: 0,
        });
        if (!next.success)
          return yield* failure("newest controls", next.error.message);
        cursor = next.data;
      } else if (
        cursor.lower !== session.lower ||
        cursor.upper !== session.upper ||
        directoryHash(cursor.makes) !== directoryHash(session.makes)
      )
        return yield* failure(
          "session recovery",
          "Native year bounds or make directory changed across checkpoints; inspect the source and restart the crawl",
        );

      while (cursor.phase !== "complete" && pagesProcessed < maxPages) {
        if (cursor.phase === "directories") {
          const make = cursor.makes[cursor.index];
          if (!make)
            return yield* failure(
              "model directory",
              "Checkpoint has no current make",
            );
          const models = yield* session.directory(make.id);
          const queries = [
            ...cursor.queries,
            ...models.map((model) => ({ makeId: make.id, modelId: model.id })),
          ];
          if (cursor.index + 1 === cursor.makes.length) {
            if (!queries.length)
              return yield* failure(
                "model directories",
                "Native model directories were all empty",
              );
            cursor = {
              source: "chesterfield",
              phase: "inventory",
              lower: cursor.lower,
              upper: cursor.upper,
              makes: cursor.makes,
              controls: cursor.controls,
              queries,
              queryIndex: 0,
              rowIndex: 0,
              pageHash: null,
              seen: [],
            };
          } else cursor = { ...cursor, index: cursor.index + 1, queries };
          continue;
        }
        if (cursor.phase !== "inventory")
          return yield* failure("checkpoint", "Unexpected traversal phase");
        const query = cursor.queries[cursor.queryIndex];
        if (!query)
          return yield* failure(
            "search",
            "Checkpoint has no current native query",
          );
        const records = yield* session.search(query);
        const pageHash = chesterfieldPageHash(records);
        if (
          cursor.rowIndex > records.length ||
          (cursor.pageHash !== null && cursor.pageHash !== pageHash)
        )
          return yield* failure(
            "row recovery",
            "Search page changed after its donor checkpoint; inspect the source and restart the crawl instead of skipping changed rows",
          );
        const seen = [...cursor.seen];
        for (const previous of records.slice(0, cursor.rowIndex)) {
          if (
            !seen.some(
              (entry) =>
                chesterfieldDonorKey(entry) ===
                  chesterfieldDonorKey(previous) &&
                entry.description === chesterfieldDescription(previous),
            )
          )
            return yield* failure(
              "row recovery",
              "Checkpoint lacks ownership evidence for a previously processed row; retain prior inventory and restart the crawl",
            );
        }
        let index = cursor.rowIndex;
        for (; index < records.length; index++) {
          const record = records[index];
          if (!record)
            return yield* failure("donor", "Native search row disappeared");
          const yard = chesterfieldYardName(record.yard);
          const owner = yard ? CHESTERFIELD_YARDS[yard] : null;
          if (!owner || !/^\d{12}$/.test(record.stock))
            return yield* failure(
              "donor identity",
              "Native row has an unidentified yard or stock; do not omit it from quality accounting",
            );
          const key = chesterfieldDonorKey(record);
          const previous = seen.find(
            (entry) => chesterfieldDonorKey(entry) === key,
          );
          const description = chesterfieldDescription(record);
          if (previous) {
            if (previous.description !== description)
              return yield* failure(
                "donor ownership",
                "Repeated donor descriptions disagree for " + key,
              );
            accounting.duplicateVehicles++;
          } else {
            const result = ChesterfieldDonor.parse(record);
            const vin =
              result.status === "available" ? result.donor.vin : result.vin;
            if (vin && seen.some((entry) => entry.vin === vin))
              return yield* failure(
                "VIN ownership",
                "Different donor owners reuse VIN " + vin,
              );
            let entry: ChesterfieldSeen;
            const evidence = {
              yard: owner.code,
              stock: record.stock,
              identity: chesterfieldIdentity(record),
              description,
            };
            if (result.status === "incomplete") {
              entry = { ...evidence, status: "incomplete", vin };
              accounting.recordsRejected++;
              if (vin) observedVins.push(vin);
            } else {
              // Four possible photo hops must fit before starting this donor.
              // No signed URL or session state is persisted to cross a chunk boundary.
              if (
                result.donor.photoUrl !== null &&
                pagesProcessed + 4 > maxPages
              )
                break;
              if (
                result.donor.blobIdentity !== null &&
                seen.some(
                  (item) =>
                    item.status === "available" &&
                    item.blobIdentity === result.donor.blobIdentity,
                )
              )
                return yield* failure(
                  "photo ownership",
                  "Different donors reuse a native photo identity",
                );
              const photoHash =
                result.donor.photoUrl === null
                  ? null
                  : yield* preserveChesterfieldPhoto(
                      result.donor.photoUrl,
                      options.photoStore,
                      countedGate,
                    ).pipe(
                      Effect.mapError((cause) =>
                        failure("photo preservation " + key, cause),
                      ),
                    );
              if (
                photoHash !== null &&
                seen.some(
                  (item) =>
                    item.status === "available" && item.photoHash === photoHash,
                )
              )
                return yield* failure(
                  "photo ownership",
                  "Different donors reuse identical photo content",
                );
              entry =
                photoHash !== null && result.donor.blobIdentity !== null
                  ? {
                      ...evidence,
                      status: "available",
                      vin: result.donor.vin,
                      photoHash,
                      blobIdentity: result.donor.blobIdentity,
                    }
                  : {
                      ...evidence,
                      status: "available",
                      vin: result.donor.vin,
                      photoHash: null,
                      blobIdentity: null,
                    };
              yield* options.onBatch([
                transformChesterfieldDonor(result.donor, photoHash, appOrigin),
              ]);
              count++;
            }
            seen.push(entry);
          }
          accounting.recordsProcessed++;
        }
        if (index < records.length) {
          cursor = {
            ...cursor,
            seen,
            rowIndex: index,
            pageHash: index === 0 ? null : pageHash,
          };
          break;
        }
        if (cursor.queryIndex + 1 === cursor.queries.length) {
          const completed = { ...cursor, seen };
          yield* ingestionValidation({
            try: () => validateCompletion(completed),
            catch: (cause) => failure("catalog completion", cause),
          });
          cursor = { source: "chesterfield", phase: "complete" };
        } else
          cursor = {
            ...cursor,
            seen,
            queryIndex: cursor.queryIndex + 1,
            rowIndex: 0,
            pageHash: null,
          };
      }
    }
    const checkpoint = ChesterfieldCursorSchema.safeParse(cursor);
    if (!checkpoint.success)
      return yield* failure("checkpoint validation", checkpoint.error.message);
    return {
      source: "chesterfield",
      status: cursor.phase === "complete" ? "complete" : "paused",
      cursor: checkpoint.data,
      pagesProcessed,
      count,
      accounting,
      observedVins,
      errors: [],
      warnings: accounting.recordsRejected
        ? [
            "Chesterfield rejected incomplete donors; valid VINs supply presence evidence only.",
          ]
        : [],
    } satisfies ChesterfieldStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        failure(
          "chunk timeout",
          "Three-minute budget exceeded; retry the last validated checkpoint",
        ),
    }),
  );
}

export function streamChesterfieldInventory<E, R>(
  options: ChesterfieldOptions<E, R>,
) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1600 millis" }).pipe(
      Effect.flatMap((gate) =>
        streamChesterfieldInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}
