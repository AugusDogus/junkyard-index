import { ingestionValidation } from "./ingestion-validation";
import { Effect, RateLimiter } from "effect";
import type { ConnectorChunkResult } from "./connector-chunk";
import type { DonorPhotoStore } from "./donor-photo-store";
import { inventoryVin } from "./inventory-vin";
import type { ProviderRequestGate } from "./provider-http-client";
import { SourceValidationPolicy } from "./source-validation";
import {
  fetchUtpapMake,
  fetchUtpapStart,
  preserveUtpapPhoto,
  UtpapProviderError,
} from "./utpap-client";
import { UtpapCursor, UtpapCursorSchema } from "./utpap-cursor";
import { joinUtpapCatalog } from "./utpap-parser";
import {
  parseUtpapDonor,
  transformUtpapDonor,
  utpapPhotoOrigin,
  type UtpapCanonicalVehicle,
} from "./utpap-transform";
import { UTPAP_YARDS, type UtpapYard } from "./utpap-yard-metadata";

interface UtpapOptions<E, R> {
  startCursor?: UtpapCursor;
  maxPages?: number;
  photoStore: DonorPhotoStore;
  appOrigin: string;
  onBatch: (vehicles: UtpapCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: UtpapYard[]) => Effect.Effect<void, E, R>;
}
export type UtpapStreamResult = ConnectorChunkResult<"utpap", UtpapCursor>;

const failure = (operation: string, cause: unknown) =>
  Effect.fail(new UtpapProviderError({ operation, cause }));

/** Each unit is a directory transition, native make search or donor photo.
 * XML and PHP must agree before any photo is fetched or donor is emitted.
 */
export function streamUtpapInventoryWithRequestGate<E, R>(
  options: UtpapOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = UtpapCursorSchema.safeParse(
      options.startCursor ?? UtpapCursor.initial,
    );
    const maxPages = options.maxPages ?? 16;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 32
    )
      return yield* failure(
        "checkpoint",
        "Use a validated Utah cursor and 1-32 page units",
      );
    yield* ingestionValidation({
      try: () => utpapPhotoOrigin(options.appOrigin),
      catch: (cause) =>
        new UtpapProviderError({
          operation: "photo application origin",
          cause,
        }),
    });
    let cursor: UtpapCursor = parsed.data;
    let pagesProcessed = 0;
    let count = 0;
    const observedVins = new Set<string>();
    const accounting = {
      recordsProcessed: 0,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    };
    while (cursor.phase !== "complete" && pagesProcessed < maxPages) {
      switch (cursor.phase) {
        case "start": {
          const snapshot = yield* fetchUtpapStart(cursor.yardCode, gate);
          const vins = snapshot.records.flatMap((record) => {
            const vin = inventoryVin(record.VIN, record.iYEAR);
            return vin ? [vin] : [];
          });
          if (
            new Set([...cursor.history.vins, ...vins]).size !==
            cursor.history.vins.length + vins.length
          )
            return yield* failure(
              "yard " + cursor.yardCode,
              "Different native stocks reuse a valid VIN",
            );
          cursor = {
            source: "utpap",
            version: cursor.version,
            phase: "makes",
            yardCode: cursor.yardCode,
            history: cursor.history,
            records: snapshot.records,
            makes: snapshot.makes,
            index: 0,
            photos: [],
          };
          break;
        }
        case "makes": {
          const make = cursor.makes[cursor.index];
          if (!make)
            return yield* failure(
              "make checkpoint",
              "Current make partition is missing",
            );
          const rows = yield* fetchUtpapMake(cursor.yardCode, make, gate);
          const photos = [...cursor.photos, ...rows];
          if (cursor.index + 1 === cursor.makes.length) {
            const records = cursor.records;
            const yardCode = cursor.yardCode;
            const donors = yield* ingestionValidation({
              try: () => joinUtpapCatalog(records, photos),
              catch: (cause) =>
                new UtpapProviderError({
                  operation: "yard " + yardCode + " XML/PHP parity",
                  cause,
                }),
            });
            cursor = {
              source: "utpap",
              version: cursor.version,
              phase: "photos",
              yardCode: cursor.yardCode,
              history: cursor.history,
              donors,
              index: 0,
              rejected: 0,
              emitted: 0,
              vins: [],
              hashes: [],
            };
          } else cursor = { ...cursor, index: cursor.index + 1, photos };
          break;
        }
        case "photos": {
          const entry = cursor.donors[cursor.index];
          if (!entry)
            return yield* failure(
              "photo checkpoint",
              "Current donor is missing",
            );
          const parsedDonor = parseUtpapDonor(
            entry.record,
            entry.photo,
            cursor.yardCode,
          );
          const vin = inventoryVin(entry.record.VIN, entry.record.iYEAR);
          const vins = vin ? [...cursor.vins, vin] : cursor.vins;
          accounting.recordsProcessed++;
          let vehicle: UtpapCanonicalVehicle | null = null;
          let hashes = cursor.hashes;
          if (parsedDonor.status === "available") {
            if (parsedDonor.donor.photoUrl === null) {
              vehicle = transformUtpapDonor(
                parsedDonor.donor,
                cursor.yardCode,
                null,
                options.appOrigin,
              );
            } else {
              const photo = yield* preserveUtpapPhoto(
                parsedDonor.donor.photoUrl,
                options.photoStore,
                gate,
              );
              if (
                cursor.history.hashes.includes(photo.hash) ||
                hashes.includes(photo.hash)
              )
                return yield* failure(
                  "yard " +
                    cursor.yardCode +
                    " photo " +
                    entry.record.STOCKNUMBER,
                  "Different donor stocks reuse the same photo bytes",
                );
              hashes = [...hashes, photo.hash];
              vehicle = transformUtpapDonor(
                parsedDonor.donor,
                cursor.yardCode,
                photo.hash,
                options.appOrigin,
              );
            }
          }
          const rejected = cursor.rejected + (vehicle === null ? 1 : 0);
          const emitted = cursor.emitted + (vehicle === null ? 0 : 1);
          const index = cursor.index + 1;
          if (vehicle === null) {
            accounting.recordsRejected++;
            if (vin) observedVins.add(vin);
          }
          const terminal = index === cursor.donors.length;
          if (
            terminal &&
            (emitted === 0 ||
              rejected / index > SourceValidationPolicy.maximumRejectionRatio)
          )
            return yield* failure(
              "yard " + cursor.yardCode + " quality",
              rejected +
                " rejected of " +
                index +
                " donors exceeds the unchanged 10% limit or leaves no complete donor",
            );
          if (vehicle !== null) {
            yield* options.onBatch([vehicle]);
            count++;
          }
          if (terminal) {
            if (options.onYards)
              yield* options.onYards([UTPAP_YARDS[cursor.yardCode]]);
            cursor =
              cursor.yardCode === "1064"
                ? {
                    source: "utpap",
                    version: cursor.version,
                    phase: "start",
                    yardCode: "1065",
                    history: {
                      vins: [...cursor.history.vins, ...vins],
                      hashes: [...cursor.history.hashes, ...hashes],
                    },
                  }
                : { source: "utpap", phase: "complete" };
          } else cursor = { ...cursor, index, rejected, emitted, vins, hashes };
          break;
        }
      }
      pagesProcessed++;
    }
    return {
      source: "utpap",
      status: cursor.phase === "complete" ? "complete" : "paused",
      cursor,
      count,
      pagesProcessed,
      accounting,
      observedVins: [...observedVins],
      errors: [],
      warnings: accounting.recordsRejected
        ? [
            "Utah rejected " +
              accounting.recordsRejected +
              " incomplete donors; independently valid VINs supply presence evidence only.",
          ]
        : [],
    } satisfies UtpapStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        new UtpapProviderError({
          operation: "checkpoint budget",
          cause:
            "Three-minute chunk limit exceeded; no advanced checkpoint returned",
        }),
    }),
  );
}
export function streamUtpapInventory<E, R>(options: UtpapOptions<E, R>) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1600 millis" }).pipe(
      Effect.flatMap((gate) =>
        streamUtpapInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}
