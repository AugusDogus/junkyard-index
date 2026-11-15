import { Effect } from "effect";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  alshnedRequestGate,
  alshnedValidated,
  fetchAlshnedPage,
  AlshnedProviderError,
} from "./alshned-client";
import {
  AlshnedCursor,
  ALSHNED_MAX_RUN_MS,
  ALSHNED_MAX_RUN_BYTES,
  type AlshnedState,
} from "./alshned-cursor";
import {
  AlshnedCatalog,
  AlshnedDonor,
  parseAlshnedOwner,
  ALSHNED_CATALOG,
  ALSHNED_CONTACT,
  ALSHNED_MAX_BYTES,
} from "./alshned-parser";
import {
  alshnedSnapshot,
  validateAlshnedSnapshot,
  type AlshnedVehicle,
} from "./alshned-transform";
import { ALSHNED_YARD, type AlshnedYard } from "./alshned-yard-metadata";
import type { ConnectorChunkAccounting } from "./connector-chunk";

export interface AlshnedOptions<E, R> {
  startCursor?: AlshnedCursor;
  maxPages?: number;
  previousAcceptedCount?: number | null;
  onBatch: (vehicles: AlshnedVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: AlshnedYard[]) => Effect.Effect<void, E, R>;
}
export interface AlshnedStreamResult {
  source: "alshned";
  status: "paused" | "complete";
  cursor: AlshnedCursor;
  count: number;
  pagesProcessed: number;
  accounting: ConnectorChunkAccounting;
  observedVins: string[];
  warnings: string[];
  errors: string[];
}
function validateRunAge(state: AlshnedState): void {
  if (
    state.phase !== "owner" &&
    (Date.now() < state.startedAt ||
      Date.now() - state.startedAt > ALSHNED_MAX_RUN_MS)
  )
    throw new Error(
      "Alshned source run deadline expired; retain the prior checkpoint and inspect source freshness before restarting",
    );
}
function nextUrl(state: AlshnedState): string {
  if (state.phase === "owner") return ALSHNED_CONTACT;
  if (state.phase === "catalog")
    return state.pages.at(-1)?.next ?? ALSHNED_CATALOG;
  if (state.phase === "details") {
    const card = state.pages.flatMap((p) => p.cards)[state.donors.length];
    if (!card) throw new Error("Alshned next ordered native donor is missing");
    return card.url;
  }
  if (state.phase === "closing") {
    const page = state.pages[state.closing.length];
    if (!page) throw new Error("Alshned closing page has no opening member");
    return page.url;
  }
  throw new Error("Alshned complete cursor has no pending native destination");
}
function advance(
  state: AlshnedState,
  raw: string,
  previous: number | null,
): AlshnedCursor {
  if (state.phase === "owner")
    return AlshnedCursor.start(
      parseAlshnedOwner(raw),
      Buffer.byteLength(raw),
      previous,
    );
  if (state.phase === "catalog") {
    const page = AlshnedCatalog.parse(raw, nextUrl(state));
    const pages = [...state.pages, page];
    return page.next
      ? AlshnedCursor.checkpoint({ ...state, pages })
      : AlshnedCursor.checkpoint({
          ...state,
          pages,
          phase: "details",
          donors: [],
        });
  }
  if (state.phase === "details") {
    const cards = state.pages.flatMap((p) => p.cards),
      card = cards[state.donors.length];
    if (!card)
      throw new Error("Alshned primary donor is outside the opening census");
    const donors = [...state.donors, AlshnedDonor.parse(raw, card)];
    return donors.length === cards.length
      ? AlshnedCursor.checkpoint({
          ...state,
          donors,
          phase: "closing",
          closing: [],
        })
      : AlshnedCursor.checkpoint({ ...state, donors });
  }
  if (state.phase === "closing") {
    const closing = [
      ...state.closing,
      AlshnedCatalog.parse(raw, nextUrl(state)),
    ];
    return AlshnedCursor.checkpoint({
      ...state,
      closing,
      phase: closing.length === state.pages.length ? "complete" : "closing",
    });
  }
  throw new Error("Alshned complete cursor cannot advance");
}
export function streamAlshnedInventoryWithRequestGate<E, R>(
  options: AlshnedOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const maxPages = options.maxPages ?? 12;
    yield* alshnedValidated("options", () => {
      if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 32)
        throw new Error("Use an integer chunk GET budget from 1 through 32");
      if (
        options.previousAcceptedCount !== undefined &&
        options.previousAcceptedCount !== null &&
        (!Number.isSafeInteger(options.previousAcceptedCount) ||
          options.previousAcceptedCount < 0)
      )
        throw new Error(
          "Previous accepted count must be a nonnegative integer or null",
        );
    });
    let cursor: AlshnedCursor = yield* alshnedValidated("checkpoint", () =>
      AlshnedCursor.parse(options.startCursor ?? AlshnedCursor.initial),
    );
    if (
      cursor.phase !== "owner" &&
      options.previousAcceptedCount !== undefined &&
      options.previousAcceptedCount !== cursor.previousAcceptedCount
    )
      return yield* Effect.fail(
        new AlshnedProviderError(
          "resume settings",
          "Previous accepted count contradicts the saved checkpoint",
        ),
      );
    const empty: AlshnedStreamResult = {
      source: "alshned",
      status: "paused",
      cursor,
      count: 0,
      pagesProcessed: 0,
      accounting: {
        recordsProcessed: 0,
        recordsRejected: 0,
        recordsExcluded: 0,
        duplicateVehicles: 0,
      },
      observedVins: [],
      warnings: [],
      errors: [],
    };
    // A validated terminal checkpoint has already emitted its closed census.
    if (cursor.phase === "complete")
      return { ...empty, status: "complete" as const };
    yield* alshnedValidated("run lifetime", () => validateRunAge(cursor));
    const started = Date.now();
    let pagesProcessed = 0;
    while (
      cursor.phase !== "complete" &&
      pagesProcessed < maxPages &&
      Date.now() - started < 60_000
    ) {
      const current: AlshnedCursor = cursor;
      const url = yield* alshnedValidated("native continuation", () => {
        if (current.phase !== "owner") {
          const bytes =
            current.ownerBytes +
            current.pages.reduce((n, p) => n + p.bytes, 0) +
            ("donors" in current
              ? current.donors.reduce((n, d) => n + d.bytes, 0)
              : 0) +
            ("closing" in current
              ? current.closing.reduce((n, p) => n + p.bytes, 0)
              : 0);
          if (
            Date.now() < current.startedAt ||
            Date.now() - current.startedAt > ALSHNED_MAX_RUN_MS ||
            bytes > ALSHNED_MAX_RUN_BYTES - ALSHNED_MAX_BYTES
          )
            throw new Error(
              "Alshned source run deadline or complete-response capacity exhausted; retain the prior checkpoint",
            );
        }
        return nextUrl(current);
      });
      const raw = yield* fetchAlshnedPage(url, gate);
      cursor = yield* alshnedValidated(
        "native " + current.phase,
        (): AlshnedCursor =>
          advance(current, raw, options.previousAcceptedCount ?? null),
      );
      pagesProcessed++;
    }
    const chunk = { ...empty, cursor, pagesProcessed };
    if (cursor.phase !== "complete") return chunk;
    yield* alshnedValidated("complete run lifetime", () =>
      validateRunAge(cursor),
    );
    const complete = cursor;
    const snapshot = yield* alshnedValidated("complete-source quality", () =>
      validateAlshnedSnapshot(
        alshnedSnapshot(complete.pages, complete.donors),
        complete.previousAcceptedCount,
      ),
    );
    yield* options.onBatch(snapshot.vehicles);
    if (options.onYards) yield* options.onYards([{ ...ALSHNED_YARD }]);
    return {
      ...chunk,
      status: "complete" as const,
      count: snapshot.vehicles.length,
      accounting: snapshot.accounting,
      observedVins: snapshot.observedVins,
      warnings: snapshot.rejections.length
        ? [
            "Alshned retained required native conflicts as rejects and independently valid VINs as presence evidence only.",
          ]
        : [],
    };
  }).pipe(
    Effect.timeoutFail({
      duration: "90 seconds",
      onTimeout: () =>
        new AlshnedProviderError(
          "chunk deadline",
          "90-second chunk deadline exceeded; no advanced checkpoint is accepted",
        ),
    }),
  );
}
export function streamAlshnedInventory<E, R>(options: AlshnedOptions<E, R>) {
  return streamAlshnedInventoryWithRequestGate(options, alshnedRequestGate);
}
