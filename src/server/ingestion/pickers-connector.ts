import { transientRejection } from "./ingestion-validation";
import { Effect, Option } from "effect";
import {
  fetchPickersApp,
  fetchPickersConfig,
  fetchPickersInventory,
  fetchPickersOwner,
  fetchPickersSearch,
  PickersProviderError,
  pickersValidated,
} from "./pickers-client";
import {
  PickersCursor,
  pickersEntry,
  pickersMissing,
  pickersPayload,
  pickersReceipt,
  pickersScopeHash,
  pickersTerminal,
  type PickersGuard,
  type PickersReceipt,
  type PickersState,
} from "./pickers-cursor";
import {
  PICKERS_MAX_REQUESTS,
  PICKERS_MAX_RESPONSE_BYTES,
  PickersNativeRowSchema,
  pickersHash,
  pickersPairKey,
  pickersPairs,
  type PickersNativeRow,
} from "./pickers-parser";
import {
  PICKERS_SEARCH_URL,
  PICKERS_SITES,
  type PickersSite,
  type PickersYard,
} from "./pickers-yard-metadata";
import type { PickersCanonicalVehicle } from "./pickers-transform";
import type { ConnectorChunkResult } from "./connector-chunk";
import type { ProviderRequestGate } from "./provider-http-client";
import { ProviderChunkClock } from "./provider-chunk-clock";
import {
  sharedProviderHostTurn,
  VINPLUS_HOST_POLICY,
} from "./shared-provider-host";
import { SourceValidationPolicy } from "./source-validation";

interface PickersOptions<E, R> {
  startCursor?: PickersCursor;
  siteCode?: PickersSite["code"];
  maxPages?: number;
  onBatch: (vehicles: PickersCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: PickersYard[]) => Effect.Effect<void, E, R>;
}
export type PickersStreamResult = ConnectorChunkResult<
  "pickers",
  PickersCursor
>;
type PickersSearchResponse = Effect.Effect.Success<
  ReturnType<typeof fetchPickersSearch>
>;
/** One Pickers origin request: its 20 s request and body deadline, then the
 * 1.6 s request gate. */
const PICKERS_ORIGIN_REQUEST_MS = 21_600;
/** Pickers origin requests that directly follow a VinPlus read for the control
 * at `next`: a native make control, or the closing owner and app reads after
 * the last bookend. */
const originRequestsAfter = (
  phase: "native-opening" | "queries" | "native-closing" | "bookends",
  next: number,
) =>
  phase === "native-opening" || phase === "native-closing"
    ? 1
    : phase === "bookends" && next === 1
      ? 2
      : 0;
/** The literal pair a query or bookend control at `next` searches. */
const searchIndex = (
  kind: "query" | "bookend",
  next: number,
  state: PickersState,
) => (kind === "bookend" ? (next === 0 ? 0 : state.pairs.length - 1) : next);
const requireCapacity = (requests: number) =>
  pickersValidated("HTTP capacity", () => {
    if (requests >= PICKERS_MAX_REQUESTS)
      throw new Error(
        "Run reached 512 HTTP requests, including guards. Inspect chunk sizing before restarting",
      );
  });
/** The yard added, sold or edited a vehicle while it was read. A fresh crawl
 * can pass once it settles, so the source retries after the usual delay
 * within its daily attempts instead of ending its day. */
function pickersDrift(message: string): Error {
  return transientRejection(
    new Error(
      message +
        "; the yard changed while it was read, so the source retries after the usual delay within its daily attempts",
    ),
  );
}
function addCost(state: PickersState, response: { bytes: number }): void {
  state.requests++;
  state.bytes += response.bytes;
  if (state.bytes > PICKERS_MAX_RESPONSE_BYTES)
    throw new Error("Run consumed more than 32 MiB of responses");
}
function addGuard(
  state: PickersState,
  kind: PickersGuard["kind"],
  response: { bodyHash: string; bytes: number },
  semanticHash: string,
): void {
  addCost(state, response);
  state.guards.push({
    kind,
    atControl: state.receipts.length,
    bodyHash: response.bodyHash,
    bytes: response.bytes,
    semanticHash,
  });
}
function addReceipt(
  state: PickersState,
  receipt: Omit<PickersReceipt, "prefix">,
): void {
  addCost(state, receipt);
  state.receipts.push(pickersReceipt(state, receipt));
}
function nativeRows(
  value: PickersNativeRow[],
  state: PickersState,
  index: number,
): void {
  if (
    pickersHash(value.map((row) => row.stock)) !==
      pickersHash([...new Set(value.map((row) => row.stock))]) ||
    value.some((row) => row.make !== state.makes[index])
  )
    throw new Error(
      "Native make control contains duplicate stocks or a different make",
    );
}

export function streamPickersInventoryWithRequestGate<E, R>(
  options: PickersOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const started = Date.now();
    const initial = yield* pickersValidated("checkpoint", () =>
      PickersCursor.parse(
        PickersCursor.serialize(options.startCursor ?? PickersCursor.initial),
      ),
    );
    const site =
      PICKERS_SITES[
        options.siteCode ??
          (initial.phase === "start"
            ? "pickers-texarkana"
            : (initial.state.siteCode ?? "pickers-texarkana"))
      ];
    if (
      initial.phase !== "start" &&
      (initial.state.siteCode ?? "pickers-texarkana") !== site.code
    )
      return yield* new PickersProviderError({
        operation: "checkpoint yard",
        cause: "Checkpoint belongs to a different physical yard",
      });
    const maxPages = options.maxPages ?? 16;
    if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 32)
      return yield* new PickersProviderError({
        operation: "chunk budget",
        cause: "Use a data-control budget from 1 to 32",
      });
    const summary: PickersStreamResult = {
      source: "pickers",
      status: "paused",
      cursor: initial,
      count: 0,
      errors: [],
      warnings: [],
      pagesProcessed: 0,
      observedVins: [],
      accounting: {
        recordsProcessed: 0,
        recordsRejected: 0,
        recordsExcluded: 0,
        duplicateVehicles: 0,
      },
    };
    if (initial.phase === "complete")
      return { ...summary, status: "complete" as const };
    let state: PickersState;
    let phase: "native-opening" | "queries" | "native-closing" | "bookends";
    let next: number;
    // A resumed query or bookend chunk reads its first search in the same
    // shared host turn as the config guard, so it advances with one turn.
    let prefetched: PickersSearchResponse | null = null;
    if (initial.phase === "start") {
      const owner = yield* fetchPickersOwner(gate, site);
      const app = yield* fetchPickersApp(gate, site);
      const inventory = yield* fetchPickersInventory(gate, undefined, site);
      const config = yield* fetchPickersConfig(gate, site).pipe(
        // A native make control follows the config read.
        sharedProviderHostTurn(site.configUrl, 1, PICKERS_ORIGIN_REQUEST_MS),
      );
      state = {
        ...(site.code === "pickers-texarkana" ? {} : { siteCode: site.code }),
        scopeHash: "",
        ownerHash: owner.value,
        appHash: app.value,
        configHash: config.value,
        makes: inventory.value.makes,
        pairs: [],
        native: [],
        entries: [],
        missing: [],
        receipts: [],
        guards: [],
        requests: 0,
        bytes: 0,
        rawSelectorOccurrences: 0,
        queryOverlapOccurrences: 0,
      };
      state.scopeHash = pickersScopeHash({
        siteCode: state.siteCode,
        ownerHash: state.ownerHash,
        appHash: state.appHash,
        configHash: state.configHash,
        makes: state.makes,
      });
      yield* pickersValidated("bootstrap accounting", () => {
        addGuard(state, "owner", owner, owner.value);
        addGuard(state, "app", app, app.value);
        addGuard(
          state,
          "inventory",
          inventory,
          pickersHash(inventory.value.makes),
        );
        addGuard(state, "config", config, config.value);
      });
      phase = "native-opening";
      next = 0;
    } else {
      state = initial.state;
      phase = initial.phase;
      next = initial.next;
      yield* requireCapacity(state.requests);
      const inventory = yield* fetchPickersInventory(gate, undefined, site);
      yield* pickersValidated("resumed native form", () => {
        if (pickersHash(inventory.value.makes) !== pickersHash(state.makes))
          throw pickersDrift("Native make directory changed during crawl");
        addGuard(
          state,
          "inventory",
          inventory,
          pickersHash(inventory.value.makes),
        );
      });
      yield* requireCapacity(state.requests);
      const searchKind =
        phase === "queries" ? "query" : phase === "bookends" ? "bookend" : null;
      const firstPair =
        searchKind !== null &&
        next < (searchKind === "query" ? state.pairs.length : 2)
          ? state.pairs[searchIndex(searchKind, next, state)]
          : undefined;
      // The config guard adds one request before the first search.
      if (firstPair) yield* requireCapacity(state.requests + 1);
      const resumed = yield* Effect.gen(function* () {
        const config = yield* fetchPickersConfig(gate, site);
        const search = firstPair
          ? yield* fetchPickersSearch(firstPair, gate, site)
          : null;
        return { config, search };
      }).pipe(
        sharedProviderHostTurn(
          site.configUrl,
          firstPair ? 2 : 1,
          originRequestsAfter(phase, next) * PICKERS_ORIGIN_REQUEST_MS,
        ),
      );
      const { config } = resumed;
      prefetched = resumed.search;
      yield* pickersValidated("resumed public location", () => {
        if (config.value !== state.configHash)
          throw pickersDrift(
            "Public resolved location configuration changed during crawl",
          );
        addGuard(state, "config", config, config.value);
      });
    }
    // Pickers origin requests take no shared host turn but can follow a late
    // VinPlus turn. Requests that cannot end by the chunk's turn horizon are
    // not started: an advanced chunk returns its checkpoint, any other chunk
    // is deferred with its cursor unchanged.
    const originFits = (requests: number) =>
      ProviderChunkClock.fits(requests * PICKERS_ORIGIN_REQUEST_MS);
    const originDeferred = Effect.flip(
      ProviderChunkClock.deferred(VINPLUS_HOST_POLICY.label, "wait"),
    );
    const phaseLength =
      phase === "native-opening" || phase === "native-closing"
        ? state.makes.length
        : phase === "queries"
          ? state.pairs.length
          : 2;
    while (
      next < phaseLength &&
      summary.pagesProcessed < maxPages &&
      // The first control always runs: a shared host turn before it may
      // already have waited past this soft check.
      (summary.pagesProcessed === 0 || Date.now() - started < 155_000)
    ) {
      yield* requireCapacity(state.requests);
      const kind =
        phase === "native-opening"
          ? "opening"
          : phase === "native-closing"
            ? "closing"
            : phase === "queries"
              ? "query"
              : "bookend";
      if (kind === "opening" || kind === "closing") {
        const make = state.makes[next];
        if (make === undefined)
          return yield* new PickersProviderError({
            operation: "native directory",
            cause: "Missing exact native make",
          });
        if (!(yield* originFits(1))) {
          if (summary.pagesProcessed > 0) break;
          return yield* originDeferred;
        }
        const response = yield* fetchPickersInventory(gate, make, site);
        yield* pickersValidated("whole native stock control", () => {
          if (pickersHash(response.value.makes) !== pickersHash(state.makes))
            throw pickersDrift(
              "Native make directory changed during traversal",
            );
          const rows = response.value.rows.map((row, ordinal) =>
            PickersNativeRowSchema.parse({ ...row, makeIndex: next, ordinal }),
          );
          nativeRows(rows, state, next);
          if (kind === "opening") {
            const stocks = new Set(state.native.map((row) => row.stock));
            if (rows.some((row) => stocks.has(row.stock)))
              throw new Error(
                "Native stock repeats across different make controls",
              );
            state.native.push(...rows);
          } else if (
            pickersHash(rows) !==
            pickersHash(state.native.filter((row) => row.makeIndex === next))
          )
            throw pickersDrift(
              "Closing native inventory changed a whole row or stock set",
            );
          addReceipt(state, {
            kind,
            index: next,
            payloadHash: pickersHash(pickersPayload(kind, next, state)),
            bodyHash: response.bodyHash,
            bytes: response.bytes,
            members: rows.map((row) => ({
              stock: row.stock,
              hash: pickersHash(row),
            })),
            own: [],
            newStocks: kind === "opening" ? rows.length : 0,
            overlap: 0,
          });
        });
      } else {
        const queryIndex = searchIndex(kind, next, state);
        const pair = state.pairs[queryIndex];
        if (!pair)
          return yield* new PickersProviderError({
            operation: "public directory",
            cause: "Missing literal native make/model",
          });
        let response: PickersSearchResponse;
        if (prefetched) {
          response = prefetched;
          prefetched = null;
        } else {
          const read = yield* fetchPickersSearch(pair, gate, site).pipe(
            sharedProviderHostTurn(
              PICKERS_SEARCH_URL,
              1,
              originRequestsAfter(phase, next) * PICKERS_ORIGIN_REQUEST_MS,
            ),
            ProviderChunkClock.unlessDeferred(summary.pagesProcessed > 0),
          );
          if (Option.isNone(read)) break;
          response = read.value;
        }
        // The last bookend leads straight to the closing owner and app reads.
        if (
          kind === "bookend" &&
          next === phaseLength - 1 &&
          !(yield* originFits(2))
        ) {
          if (summary.pagesProcessed > 0) break;
          return yield* originDeferred;
        }
        yield* pickersValidated(
          "whole public records and stock binding",
          () => {
            const natives = new Map(
              state.native.map((row) => [row.stock, row]),
            );
            const seen = new Map(
              state.entries.map((entry) => [entry.record.stock, entry]),
            );
            let newStocks = 0;
            const members = response.value.map((record) => {
              const prior = seen.get(record.stock);
              const entry = pickersEntry(
                record,
                natives.get(record.stock) ?? null,
                prior?.firstQuery ?? queryIndex,
                site,
              );
              const comparable = (value: typeof entry) => ({
                ...value,
                record: {
                  ...value.record,
                  fields: { ...value.record.fields, daysInYard: undefined },
                },
              });
              if (
                prior &&
                pickersHash(comparable(prior)) !==
                  pickersHash(comparable(entry))
              ) {
                const message =
                  "Repeated stock changed a whole record: " + record.stock;
                // A bookend repeats an exact earlier query, so a changed
                // record there was edited during the crawl.
                throw kind === "bookend"
                  ? pickersDrift(message)
                  : new Error(message);
              }
              if (!prior) {
                if (kind === "bookend")
                  throw pickersDrift(
                    "Exact query bookend introduced a new stock " +
                      record.stock +
                      " for " +
                      pair.make +
                      " / " +
                      pair.model,
                  );
                seen.set(record.stock, entry);
                state.entries.push(entry);
                newStocks++;
              }
              return { stock: record.stock, hash: pickersHash(prior ?? entry) };
            });
            const returned = new Set(members.map((member) => member.stock));
            const own = state.native
              .filter((row) => pickersPairKey(row) === pickersPairKey(pair))
              .map((row) => ({
                stock: row.stock,
                hit: returned.has(row.stock),
              }));
            if (kind === "bookend") {
              const opening = state.receipts.find(
                (receipt) =>
                  receipt.kind === "query" && receipt.index === queryIndex,
              );
              // The checkpoint validator binds each bookend to its query
              // receipt (pickers-cursor.ts), so this is unreachable; if it
              // ever fires it is a crawler defect, not yard drift.
              if (!opening)
                throw new Error(
                  "Bookend " +
                    next +
                    " has no opening query receipt " +
                    queryIndex +
                    " in its checkpoint. Inspect the Pickers checkpoint validator and bookend indexing before restarting",
                );
              if (
                (opening.comparisonHash ?? opening.bodyHash) !==
                  (response.comparisonHash ?? response.bodyHash) ||
                pickersHash(opening.members) !== pickersHash(members)
              )
                throw pickersDrift(
                  "Exact public query bookend changed its whole response",
                );
            } else {
              state.rawSelectorOccurrences += members.length;
              state.queryOverlapOccurrences += members.length - newStocks;
            }
            addReceipt(state, {
              kind,
              index: next,
              payloadHash: pickersHash(pickersPayload(kind, next, state)),
              bodyHash: response.bodyHash,
              comparisonHash: response.comparisonHash,
              bytes: response.bytes,
              members,
              own,
              newStocks,
              overlap: kind === "query" ? members.length - newStocks : 0,
            });
          },
        );
      }
      next++;
      summary.pagesProcessed++;
    }
    if (!summary.pagesProcessed)
      return yield* new PickersProviderError({
        operation: "elapsed budget",
        cause: "No data control completed within the three-minute chunk budget",
      });
    if (next === phaseLength) {
      if (phase === "native-opening") {
        phase = "queries";
        next = 0;
        state.pairs = pickersPairs(state.native);
      } else if (phase === "queries") {
        phase = "native-closing";
        next = 0;
        state.missing = pickersMissing(state);
      } else if (phase === "native-closing") {
        phase = "bookends";
        next = 0;
      } else {
        yield* requireCapacity(state.requests);
        const owner = yield* fetchPickersOwner(gate, site);
        yield* pickersValidated("closing native ownership", () => {
          if (owner.value !== state.ownerHash)
            throw new Error(
              "Native ownership or active inventory statement changed",
            );
          addGuard(state, "owner", owner, owner.value);
        });
        yield* requireCapacity(state.requests);
        const app = yield* fetchPickersApp(gate, site);
        yield* pickersValidated("closing app relationship", () => {
          if (app.value !== state.appHash)
            throw new Error("Public app yard-info contract changed");
          addGuard(state, "app", app, app.value);
        });
        const terminal = yield* pickersValidated(
          "terminal coverage and quality",
          () => {
            const cursor = PickersCursor.complete(state);
            const result = pickersTerminal(state);
            if (
              !result.proof.emitted ||
              result.proof.rejected / result.proof.processed >
                SourceValidationPolicy.maximumRejectionRatio
            )
              throw new Error(
                result.proof.rejected +
                  " rejected of " +
                  result.proof.processed +
                  " unique stocks exceeds the unchanged 10% rejection limit or leaves no valid donors",
              );
            return { cursor, ...result };
          },
        );
        const count = terminal.vehicles.length;
        const accounting = {
          recordsProcessed: terminal.proof.processed,
          recordsRejected: terminal.proof.rejected,
          recordsExcluded: 0,
          duplicateVehicles: 0,
        };
        yield* options.onBatch(structuredClone(terminal.vehicles));
        if (options.onYards) yield* options.onYards([{ ...site.yard }]);
        return {
          ...summary,
          status: "complete" as const,
          cursor: terminal.cursor,
          count,
          observedVins: terminal.presence,
          accounting,
        };
      }
    }
    const cursor = yield* pickersValidated("next checkpoint", () =>
      PickersCursor.checkpoint(phase, next, state),
    );
    return { ...summary, cursor };
  }).pipe(
    ProviderChunkClock.deadline({
      duration: "3 minutes",
      onTimeout: () =>
        new PickersProviderError({
          operation: "chunk deadline",
          cause: "Three-minute hard deadline exceeded",
        }),
    }),
  );
}
export function streamPickersInventory<E, R>(options: PickersOptions<E, R>) {
  // Sequential source controls, including body reads, finish before this pause.
  const gate = pickersRequestGate;
  return streamPickersInventoryWithRequestGate(options, gate);
}

export const pickersRequestGate: ProviderRequestGate = (request) =>
  request.pipe(Effect.ensuring(Effect.sleep("1600 millis")));
