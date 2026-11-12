import { Effect } from "effect";
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
import { PICKERS_YARD, type PickersYard } from "./pickers-yard-metadata";
import type { PickersCanonicalVehicle } from "./pickers-transform";
import type { ConnectorChunkResult } from "./connector-chunk";
import type { ProviderRequestGate } from "./provider-http-client";
import { SourceValidationPolicy } from "./source-validation";

interface PickersOptions<E, R> {
  startCursor?: PickersCursor;
  maxPages?: number;
  onBatch: (vehicles: PickersCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: PickersYard[]) => Effect.Effect<void, E, R>;
}
export type PickersStreamResult = ConnectorChunkResult<
  "pickers",
  PickersCursor
>;
const requireCapacity = (requests: number) =>
  pickersValidated("HTTP capacity", () => {
    if (requests >= PICKERS_MAX_REQUESTS)
      throw new Error(
        "Run reached 512 HTTP requests, including guards. Inspect chunk sizing before restarting",
      );
  });
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
    if (initial.phase === "start") {
      const owner = yield* fetchPickersOwner(gate);
      const app = yield* fetchPickersApp(gate);
      const inventory = yield* fetchPickersInventory(gate);
      const config = yield* fetchPickersConfig(gate);
      state = {
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
      const inventory = yield* fetchPickersInventory(gate);
      yield* pickersValidated("resumed native form", () => {
        if (pickersHash(inventory.value.makes) !== pickersHash(state.makes))
          throw new Error("Native make directory changed during crawl");
        addGuard(
          state,
          "inventory",
          inventory,
          pickersHash(inventory.value.makes),
        );
      });
      yield* requireCapacity(state.requests);
      const config = yield* fetchPickersConfig(gate);
      yield* pickersValidated("resumed public location", () => {
        if (config.value !== state.configHash)
          throw new Error(
            "Public resolved location configuration changed during crawl",
          );
        addGuard(state, "config", config, config.value);
      });
    }
    const phaseLength =
      phase === "native-opening" || phase === "native-closing"
        ? state.makes.length
        : phase === "queries"
          ? state.pairs.length
          : 2;
    while (
      next < phaseLength &&
      summary.pagesProcessed < maxPages &&
      Date.now() - started < 155_000
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
        const response = yield* fetchPickersInventory(gate, make);
        yield* pickersValidated("whole native stock control", () => {
          if (pickersHash(response.value.makes) !== pickersHash(state.makes))
            throw new Error("Native make directory changed during traversal");
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
            throw new Error(
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
        const queryIndex =
          kind === "bookend" ? (next === 0 ? 0 : state.pairs.length - 1) : next;
        const pair = state.pairs[queryIndex];
        if (!pair)
          return yield* new PickersProviderError({
            operation: "public directory",
            cause: "Missing literal native make/model",
          });
        const response = yield* fetchPickersSearch(pair, gate);
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
              );
              if (prior && pickersHash(prior) !== pickersHash(entry))
                throw new Error(
                  "Repeated stock changed a whole record: " + record.stock,
                );
              if (!prior) {
                if (kind === "bookend")
                  throw new Error("Exact query bookend introduced a new stock");
                seen.set(record.stock, entry);
                state.entries.push(entry);
                newStocks++;
              }
              return { stock: record.stock, hash: pickersHash(entry) };
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
              if (
                !opening ||
                opening.bodyHash !== response.bodyHash ||
                pickersHash(opening.members) !== pickersHash(members)
              )
                throw new Error(
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
        const owner = yield* fetchPickersOwner(gate);
        yield* pickersValidated("closing native ownership", () => {
          if (owner.value !== state.ownerHash)
            throw new Error(
              "Native ownership or active inventory statement changed",
            );
          addGuard(state, "owner", owner, owner.value);
        });
        yield* requireCapacity(state.requests);
        const app = yield* fetchPickersApp(gate);
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
        if (options.onYards) yield* options.onYards([{ ...PICKERS_YARD }]);
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
    Effect.timeoutFail({
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
  const gate: ProviderRequestGate = (request) =>
    request.pipe(Effect.tap(() => Effect.sleep("1600 millis")));
  return streamPickersInventoryWithRequestGate(options, gate);
}
