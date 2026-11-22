import { z } from "zod";
import {
  PIPES_MAX_MAKES,
  PIPES_MAX_QUERIES,
  PIPES_MAX_RESPONSE_BYTES,
  PIPES_MAX_STOCKS,
  PIPES_SCOPE,
  PipesNativeRowSchema,
  parsePipesConfig,
  parsePipesDirections,
  parsePipesInventory,
  parsePipesOwner,
  parsePipesSearch,
  pipesBodyHash,
  pipesHash,
  pipesPairs,
  pipesPhotoStock,
  pipesRecordHash,
  type PipesNativeRow,
  type PipesPair,
  type PipesRecord,
} from "./pipes-parser";
import { classifyPipesInventory } from "./pipes-transform";
import { inventoryVin } from "./inventory-vin";
import { SourceValidationPolicy } from "./source-validation";
import {
  PIPES_CONFIG_URL,
  PIPES_DIRECTIONS_URL,
  PIPES_EMBED_URL,
  PIPES_INVENTORY_URL,
  PIPES_LOCATION_ID,
  PIPES_SEARCH_URL,
  PIPES_YARD,
} from "./pipes-yard-metadata";

export const PIPES_MAX_CURSOR_BYTES = 1024 * 1024;
export const PIPES_MAX_RUN_REQUESTS = 512;
export const PIPES_MAX_RUN_BYTES = 32 * 1024 * 1024;
/** Closing drift restarts the crawl from its opening controls at most this
 * many times per run, so a source that keeps changing still fails. */
export const PIPES_MAX_RESTARTS = 2;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const PipesRawReceiptSchema = z
  .object({
    raw: z.string().max(PIPES_MAX_RESPONSE_BYTES),
    bodyHash: hash,
    bytes: z.number().int().positive().max(PIPES_MAX_RESPONSE_BYTES),
  })
  .strict();
export type PipesRawReceipt = z.infer<typeof PipesRawReceiptSchema>;
const nativePage = z
  .object({
    make: z.string().min(1).max(512),
    rows: z.array(PipesNativeRowSchema).max(PIPES_MAX_STOCKS),
    hash,
    bodyHash: hash,
    bytes: z.number().int().positive().max(PIPES_MAX_RESPONSE_BYTES),
  })
  .strict();
export type PipesNativePage = z.infer<typeof nativePage>;
const closingPage = z
  .object({
    hash,
    bodyHash: hash,
    bytes: z.number().int().positive().max(PIPES_MAX_RESPONSE_BYTES),
  })
  .strict();
export const PIPES_CURSOR_SCOPE = pipesHash({
  version: 1,
  yard: PIPES_YARD,
  inventory: PIPES_INVENTORY_URL,
  directions: PIPES_DIRECTIONS_URL,
  embed: PIPES_EMBED_URL,
  config: PIPES_CONFIG_URL,
  search: PIPES_SEARCH_URL,
  identity: {
    owner: PIPES_SCOPE.yardId,
    location: PIPES_LOCATION_ID,
    site: PIPES_SCOPE.yardName,
    sourceSystem: PIPES_SCOPE.sourceSystem,
  },
  authority:
    "native-whole-ymm/api-identity/api-dateAdded-offset-literal/native-optionals/union-quarantine-v1",
});
const common = {
  source: z.literal("pipes"),
  version: z.literal(1),
  scope: z.literal(PIPES_CURSOR_SCOPE),
  checksum: hash,
  opening: z.array(PipesRawReceiptSchema).max(4),
  native: z.array(nativePage).max(PIPES_MAX_MAKES),
  queries: z.array(PipesRawReceiptSchema).max(PIPES_MAX_QUERIES),
  closingNative: z.array(closingPage).max(PIPES_MAX_MAKES),
  bookends: z.array(PipesRawReceiptSchema).max(2),
  closingContext: z.array(PipesRawReceiptSchema).max(4),
  restarts: z.number().int().min(0).max(PIPES_MAX_RESTARTS).default(0),
};
const rawCursor = z.discriminatedUnion("phase", [
  z.object({ ...common, phase: z.literal("opening") }).strict(),
  z.object({ ...common, phase: z.literal("native") }).strict(),
  z.object({ ...common, phase: z.literal("enrichment") }).strict(),
  z.object({ ...common, phase: z.literal("closing-native") }).strict(),
  z.object({ ...common, phase: z.literal("bookends") }).strict(),
  z.object({ ...common, phase: z.literal("closing-context") }).strict(),
  z.object({ ...common, phase: z.literal("complete") }).strict(),
]);
type State = z.infer<typeof rawCursor>;
export type PipesPhase = State["phase"];

function stateHash(state: Omit<State, "checksum"> | State) {
  return pipesHash({
    source: state.source,
    version: state.version,
    scope: state.scope,
    phase: state.phase,
    opening: state.opening,
    native: state.native,
    queries: state.queries,
    closingNative: state.closingNative,
    bookends: state.bookends,
    closingContext: state.closingContext,
    // Zero is omitted so checkpoints saved before restarts existed keep
    // their checksum.
    restarts: state.restarts || undefined,
  });
}
export function pipesReceipt(raw: string): PipesRawReceipt {
  return { raw, bodyHash: pipesBodyHash(raw), bytes: Buffer.byteLength(raw) };
}
/** Ordered whole-record fingerprints of one query response. Only the
 * daily-stamped daysInYard is excluded, as for repeated stocks. */
export function pipesQueryHash(raw: string, pair: PipesPair) {
  return pipesHash(parsePipesSearch(raw, pair).map(pipesRecordHash));
}
function verifyRaw(receipt: PipesRawReceipt) {
  if (
    receipt.bodyHash !== pipesBodyHash(receipt.raw) ||
    receipt.bytes !== Buffer.byteLength(receipt.raw)
  )
    throw new Error(
      "Pipes checkpoint raw response bytes or fingerprint changed",
    );
}
export function pipesContextValue(index: number, raw: string): unknown {
  switch (index) {
    case 0:
      return parsePipesOwner(raw);
    case 1:
      return parsePipesInventory(raw, null);
    case 2:
      return parsePipesDirections(raw);
    case 3:
      return parsePipesConfig(raw);
    default:
      throw new Error(
        "Pipes context index is outside the four verified controls",
      );
  }
}
function context(opening: readonly PipesRawReceipt[]) {
  const values = opening.map((receipt, index) => {
    verifyRaw(receipt);
    return pipesContextValue(index, receipt.raw);
  });
  const menu = opening[1];
  return {
    values,
    makes: menu ? parsePipesInventory(menu.raw, null).makes : [],
  };
}

/** Reconstruct the entire trusted prefix, including raw optional fields. This
 * validates internal corruption; checksums are not cursor authentication.
 */
export function inspectPipesCursor(state: State) {
  const opening = context(state.opening),
    makes = opening.makes;
  const rows: PipesNativeRow[] = [],
    stocks = new Set<string>();
  for (const [index, page] of state.native.entries()) {
    if (
      page.make !== makes[index] ||
      page.hash !== pipesHash({ make: page.make, rows: page.rows })
    )
      throw new Error(
        "Pipes checkpoint native page fingerprint or contiguous make prefix changed",
      );
    for (const row of page.rows) {
      const expectedYear =
        /^\d{4}$/.test(row.rawYear) &&
        Number(row.rawYear) >= 1886 &&
        Number(row.rawYear) <= 2100
          ? Number(row.rawYear)
          : null;
      const photoKeys = new Set(
        [...row.photos, ...row.images].flatMap((photo) => {
          const stock = pipesPhotoStock(photo);
          return stock ? [stock] : [];
        }),
      );
      if (
        row.year !== expectedYear ||
        (row.make && row.make !== page.make) ||
        photoKeys.size > 1 ||
        row.stock !== ([...photoKeys][0] ?? null) ||
        (row.stock && stocks.has(row.stock))
      )
        throw new Error(
          "Pipes checkpoint native row/year/photo association is invalid or duplicated",
        );
      if (row.stock) stocks.add(row.stock);
      rows.push(row);
    }
  }
  if (rows.length > PIPES_MAX_STOCKS)
    throw new Error("Pipes checkpoint native census exceeds its row capacity");
  const pairs = pipesPairs(rows),
    records = new Map<string, PipesRecord>(),
    identityStocks = new Map<string, string>();
  const nativeByStock = new Map(
    rows.flatMap((row) => (row.stock ? [[row.stock, row] as const] : [])),
  );
  let rawApiRows = 0,
    repeats = 0;
  for (const [index, receipt] of state.queries.entries()) {
    verifyRaw(receipt);
    const pair = pairs[index];
    if (!pair)
      throw new Error(
        "Pipes checkpoint query receipt is outside its complete literal directory",
      );
    for (const record of parsePipesSearch(receipt.raw, pair)) {
      rawApiRows++;
      const native = nativeByStock.get(record.stock);
      if (
        native?.year !== undefined &&
        native.year !== null &&
        native.year !== record.year
      )
        throw new Error(
          "Pipes identity query conflicts with native stock/year " +
            record.stock,
        );
      const prior = records.get(record.stock);
      if (prior) {
        if (pipesRecordHash(prior) !== pipesRecordHash(record))
          throw new Error(
            "Pipes repeated identity stock changed its stable whole record " +
              record.stock,
          );
        repeats++;
        continue;
      }
      const vin =
        typeof record.vin === "string"
          ? inventoryVin(
              record.vin,
              native
                ? native.year === null
                  ? ""
                  : String(native.year)
                : String(record.year),
            )
          : null;
      const priorStock = vin ? identityStocks.get(vin) : undefined;
      if (priorStock && priorStock !== record.stock)
        throw new Error(
          "Pipes distinct stocks reuse a valid VIN/serial " + vin,
        );
      if (vin) identityStocks.set(vin, record.stock);
      records.set(record.stock, record);
    }
  }
  if (
    rows.length +
      [...records.keys()].filter((stock) => !stocks.has(stock)).length >
    PIPES_MAX_STOCKS
  )
    throw new Error(
      "Pipes checkpoint union exceeds its bounded stock capacity",
    );
  for (const [index, page] of state.closingNative.entries()) {
    if (page.hash !== state.native[index]?.hash)
      throw new Error(
        "Pipes complete closing native census differs from opening",
      );
  }
  const bookendIndexes = pairs.length ? [0, pairs.length - 1] : [];
  for (const [index, receipt] of state.bookends.entries()) {
    verifyRaw(receipt);
    const originalIndex = bookendIndexes[index];
    const original =
      originalIndex === undefined ? undefined : state.queries[originalIndex];
    const pair = originalIndex === undefined ? undefined : pairs[originalIndex];
    if (
      !original ||
      !pair ||
      pipesQueryHash(original.raw, pair) !== pipesQueryHash(receipt.raw, pair)
    )
      throw new Error("Pipes query bookend records changed");
  }
  for (const [index, receipt] of state.closingContext.entries()) {
    verifyRaw(receipt);
    if (
      pipesHash(pipesContextValue(index, receipt.raw)) !==
      pipesHash(opening.values[index])
    )
      throw new Error(
        "Pipes closing physical ownership, menu or public child configuration changed",
      );
  }
  const allReceipts = [
    ...state.opening,
    ...state.native,
    ...state.queries,
    ...state.closingNative,
    ...state.bookends,
    ...state.closingContext,
  ];
  const requests = allReceipts.length,
    bytes = allReceipts.reduce((sum, receipt) => sum + receipt.bytes, 0);
  if (requests > PIPES_MAX_RUN_REQUESTS || bytes > PIPES_MAX_RUN_BYTES)
    throw new Error(
      "Pipes run exceeds its bounded request or response-byte capacity",
    );
  const lengths = [
    state.opening.length,
    state.native.length,
    state.queries.length,
    state.closingNative.length,
    state.bookends.length,
    state.closingContext.length,
  ];
  const totals = [
    4,
    makes.length,
    pairs.length,
    makes.length,
    bookendIndexes.length,
    4,
  ];
  const phases = [
    "opening",
    "native",
    "enrichment",
    "closing-native",
    "bookends",
    "closing-context",
  ];
  const phaseIndex =
    state.phase === "complete" ? 6 : phases.indexOf(state.phase);
  for (let index = 0; index < lengths.length; index++) {
    const count = lengths[index] ?? -1,
      total = totals[index] ?? -1;
    if (
      (index < phaseIndex && count !== total) ||
      (index === phaseIndex && count >= total) ||
      (index > phaseIndex && count !== 0)
    )
      throw new Error(
        "Pipes checkpoint phase does not match its complete contiguous control prefix",
      );
  }
  if (phaseIndex >= 2 && (!rows.length || !makes.length))
    throw new Error(
      "Pipes native census is empty; prior inventory must be preserved",
    );
  const classified = classifyPipesInventory(rows, records);
  if (
    state.phase === "complete" &&
    (!classified.vehicles.length ||
      classified.rejected / classified.processed >
        SourceValidationPolicy.maximumRejectionRatio)
  )
    throw new Error(
      "Pipes required rejection ratio exceeds the unchanged 10% cap or leaves no valid donors",
    );
  return {
    makes,
    rows,
    pairs,
    records,
    rawApiRows,
    repeats,
    requests,
    bytes,
    classified,
    contextHash: pipesHash(opening.values),
  };
}
export const PipesCursorSchema = rawCursor.superRefine((state, context) => {
  try {
    if (state.checksum !== stateHash(state))
      throw new Error("Pipes checkpoint full-prefix checksum changed");
    inspectPipesCursor(state);
    if (
      Buffer.byteLength(JSON.stringify({ ...state, source: undefined })) >
      PIPES_MAX_CURSOR_BYTES
    )
      throw new Error("Pipes checkpoint exceeds one MiB");
  } catch (cause) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        cause instanceof Error
          ? cause.message
          : "Invalid Pipes full-prefix checkpoint",
    });
  }
});
export type PipesCursor = z.infer<typeof PipesCursorSchema>;
export type PipesCursorProgress = Omit<PipesCursor, "checksum">;
function checkpoint(progress: PipesCursorProgress): PipesCursor {
  return PipesCursorSchema.parse({
    ...progress,
    checksum: stateHash(progress),
  });
}
const initial = checkpoint({
  source: "pipes",
  version: 1,
  scope: PIPES_CURSOR_SCOPE,
  phase: "opening",
  opening: [],
  native: [],
  queries: [],
  closingNative: [],
  bookends: [],
  closingContext: [],
  restarts: 0,
});
export const PipesCursor = {
  initial,
  checkpoint,
  /** Discard every receipt and begin again from the opening controls. The
   * schema bounds the counter, so a further restart fails validation. */
  restart(cursor: PipesCursor): PipesCursor {
    return checkpoint({ ...initial, restarts: cursor.restarts + 1 });
  },
  parse(serialized: string): PipesCursor {
    if (Buffer.byteLength(serialized) > PIPES_MAX_CURSOR_BYTES)
      throw new Error(
        "Pipes serialized checkpoint exceeds one MiB before JSON decoding; retain the last validated checkpoint",
      );
    const value: unknown = JSON.parse(serialized);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.hasOwn(value, "source")
    )
      throw new Error(
        "Pipes checkpoint wire payload must omit its fixed source tag",
      );
    return PipesCursorSchema.parse({ ...value, source: "pipes" });
  },
  serialize(cursor: PipesCursor): string {
    const parsed = PipesCursorSchema.parse(cursor);
    const serialized = JSON.stringify({ ...parsed, source: undefined });
    if (Buffer.byteLength(serialized) > PIPES_MAX_CURSOR_BYTES)
      throw new Error(
        "Pipes serialized checkpoint exceeds one MiB; retain the last validated checkpoint",
      );
    return serialized;
  },
} as const;
