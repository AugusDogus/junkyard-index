import { ingestionValidation } from "./ingestion-validation";
import { Effect, RateLimiter } from "effect";
import type { Yard } from "~/lib/yard";
import type { ConnectorChunkResult } from "./connector-chunk";
import { fetchFenixPage, FenixProviderError } from "./fenix-client";
import {
  FenixCursor,
  FenixCursorSchema,
  type FenixEntry,
  type FenixPageEvidence,
} from "./fenix-cursor";
import { FenixDonor } from "./fenix-donor";
import { validateFenixYardEvidence } from "./fenix-evidence";
import {
  fenixHash,
  fenixPageUrl,
  type parseFenixInventory,
} from "./fenix-parser";
import {
  transformFenixDonor,
  type FenixCanonicalVehicle,
} from "./fenix-transform";
import {
  FENIX_INVENTORY_URL,
  FENIX_YARD_CODES,
  FENIX_YARDS,
  type FenixYardCode,
} from "./fenix-yard-metadata";
import type { ProviderRequestGate } from "./provider-http-client";

interface FenixOptions<E, R> {
  startCursor?: FenixCursor;
  maxPages?: number;
  onBatch: (vehicles: FenixCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: Yard[]) => Effect.Effect<void, E, R>;
}
export type FenixStreamResult = ConnectorChunkResult<"fenix", FenixCursor>;
const failure = (operation: string, cause: unknown) =>
  new FenixProviderError({ operation, cause });

export function streamFenixInventoryWithRequestGate<E, R>(
  options: FenixOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = FenixCursorSchema.safeParse(
      options.startCursor ?? FenixCursor.initial,
    );
    const maxPages = options.maxPages ?? 16;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 3 ||
      maxPages > 32
    )
      return yield* failure(
        "checkpoint",
        "Expected a validated cursor and 3-32 HTTP requests",
      );
    let cursor: Exclude<FenixCursor, { phase: "start" }> =
      parsed.data.phase === "start"
        ? {
            source: "fenix",
            phase: "inventory",
            yardIndex: 0,
            order: "DESC",
            page: 1,
            entries: [],
            pages: [],
            verified: [],
            checks: [],
          }
        : parsed.data;
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
        pagesProcessed++;
        return gate(request);
      });
    const entries: FenixEntry[] =
      cursor.phase === "complete" ? [] : cursor.entries;
    const owners = new Map(entries.map((entry) => [entry.record.id, entry]));
    const vinOwners = new Map(
      entries.flatMap((entry) => {
        const result = FenixDonor.parse(entry.record);
        const vin =
          result.status === "available" ? result.donor.vin : result.vin;
        return vin ? [[vin, entry.record.id] as const] : [];
      }),
    );
    // A resumed traversal rechecks its head and most recent processed page.
    if (cursor.phase === "inventory") {
      const yard = FENIX_YARD_CODES[cursor.yardIndex];
      if (!yard) return yield* failure("yard", "Unknown physical yard index");
      const current = cursor;
      const previous = current.pages.filter(
        (page) => page.yard === yard && page.order === current.order,
      );
      const controls = [...new Set([previous[0], previous.at(-1)])].filter(
        (page): page is FenixPageEvidence => page !== undefined,
      );
      for (const control of controls) {
        const page = yield* fetchFenixPage(
          fenixPageUrl(control.order, control.page),
          yard,
          control.order,
          control.page,
          countedGate,
        );
        if (page.hash !== control.hash || page.lastPage !== control.lastPage)
          return yield* failure(
            "resume drift",
            "Processed head or page changed for " + yard,
          );
      }
    }
    while (cursor.phase !== "complete" && pagesProcessed < maxPages) {
      const yard = FENIX_YARD_CODES[cursor.yardIndex];
      if (!yard) return yield* failure("yard", "Unknown physical yard index");
      if (cursor.phase === "verify") {
        const order = cursor.controlIndex < 2 ? "DESC" : "ASC";
        const pages = cursor.pages.filter(
          (page) => page.yard === yard && page.order === order,
        );
        const control = cursor.controlIndex % 2 === 0 ? pages[0] : pages.at(-1);
        if (!control)
          return yield* failure(
            "completion",
            "Missing native head or terminal control",
          );
        const page = yield* fetchFenixPage(
          fenixPageUrl(order, control.page),
          yard,
          order,
          control.page,
          countedGate,
        );
        if (page.hash !== control.hash || page.lastPage !== control.lastPage)
          return yield* failure(
            "completion drift",
            "Native head or terminal page changed for " + yard,
          );
        const checks: typeof cursor.checks = [
          ...cursor.checks,
          { yard, order, page: control.page, hash: page.hash },
        ];
        if (cursor.controlIndex < 3)
          cursor = { ...cursor, checks, controlIndex: cursor.controlIndex + 1 };
        else {
          const completed = cursor;
          yield* ingestionValidation({
            try: () =>
              validateFenixYardEvidence(
                completed.entries,
                completed.pages,
                yard,
              ),
            catch: (cause) => failure("catalog completeness", cause),
          });
          const verified: FenixYardCode[] = [...cursor.verified, yard];
          cursor =
            cursor.yardIndex === FENIX_YARD_CODES.length - 1
              ? {
                  source: "fenix",
                  phase: "complete",
                  entries: cursor.entries,
                  pages: cursor.pages,
                  verified,
                  checks,
                }
              : {
                  source: "fenix",
                  phase: "inventory",
                  yardIndex: cursor.yardIndex + 1,
                  order: "DESC",
                  page: 1,
                  entries: cursor.entries,
                  pages: cursor.pages,
                  verified,
                  checks,
                };
        }
        continue;
      }
      const page: ReturnType<typeof parseFenixInventory> =
        yield* fetchFenixPage(
          cursor.order === "DESC" && cursor.page === 1
            ? FENIX_INVENTORY_URL
            : fenixPageUrl(cursor.order, cursor.page),
          yard,
          cursor.order,
          cursor.page,
          countedGate,
        );
      if (options.onYards) yield* options.onYards(Object.values(FENIX_YARDS));
      const current: Extract<FenixCursor, { phase: "inventory" }> = cursor;
      const previousPages = current.pages.filter(
        (entry) => entry.yard === yard && entry.order === current.order,
      );
      if (previousPages.some((entry) => entry.lastPage !== page.lastPage))
        return yield* failure(
          "page drift",
          "Published terminal page changed for " + yard,
        );
      const sameOrder = new Set(previousPages.flatMap((entry) => entry.ids));
      const batch: FenixCanonicalVehicle[] = [];
      for (const record of page.records) {
        accounting.recordsProcessed++;
        const owner = owners.get(record.id);
        if (owner) {
          if (
            owner.yard !== yard ||
            fenixHash(owner.record) !== fenixHash(record)
          )
            return yield* failure(
              "donor ownership",
              "Repeated native detail changed identity or description: " +
                record.id,
            );
          if (sameOrder.has(record.id)) accounting.duplicateVehicles++;
          else accounting.recordsExcluded++; // Deliberate opposite-order presence control.
        } else {
          const result = FenixDonor.parse(record);
          const vin =
            result.status === "available" ? result.donor.vin : result.vin;
          if (vin && vinOwners.has(vin))
            return yield* failure(
              "VIN ownership",
              "Different native details reuse VIN " + vin,
            );
          const entry = { yard, record };
          owners.set(record.id, entry);
          current.entries.push(entry);
          if (vin) vinOwners.set(vin, record.id);
          if (result.status === "incomplete") {
            accounting.recordsRejected++;
            if (vin) observedVins.push(vin);
          } else batch.push(transformFenixDonor(result.donor, yard, record.id));
        }
        sameOrder.add(record.id);
      }
      current.pages.push({
        yard,
        order: current.order,
        page: current.page,
        lastPage: page.lastPage,
        ids: page.records.map((record) => record.id),
        hash: page.hash,
      });
      if (batch.length) {
        yield* options.onBatch(batch);
        count += batch.length;
      }
      cursor =
        current.page < page.lastPage
          ? { ...current, page: current.page + 1 }
          : current.order === "DESC"
            ? { ...current, order: "ASC", page: 1 }
            : {
                source: "fenix",
                phase: "verify",
                yardIndex: current.yardIndex,
                controlIndex: 0,
                entries: current.entries,
                pages: current.pages,
                verified: current.verified,
                checks: current.checks,
              };
    }
    const checkpoint = FenixCursorSchema.safeParse(cursor);
    if (!checkpoint.success)
      return yield* failure("checkpoint validation", checkpoint.error.message);
    return {
      source: "fenix",
      status: cursor.phase === "complete" ? "complete" : "paused",
      cursor: checkpoint.data,
      count,
      pagesProcessed,
      accounting,
      observedVins,
      errors: [],
      warnings: accounting.recordsRejected
        ? [
            "Fenix rejected incomplete donors; valid rejected VINs supply presence evidence only.",
          ]
        : [],
    } satisfies FenixStreamResult;
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

export function streamFenixInventory<E, R>(options: FenixOptions<E, R>) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1600 millis" }).pipe(
      Effect.flatMap((gate) =>
        streamFenixInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}
