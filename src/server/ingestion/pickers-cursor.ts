import { z } from "zod";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  PICKERS_MAX_MAKES,
  PICKERS_MAX_NATIVE_STOCKS,
  PICKERS_MAX_OCCURRENCES,
  PICKERS_MAX_QUERIES,
  PICKERS_MAX_REQUESTS,
  PICKERS_MAX_RESPONSE_BYTES,
  PICKERS_MAX_STOCKS,
  PICKERS_SCOPE,
  pickersScope,
  PickersHashSchema,
  PickersNativeRowSchema,
  PickersPairSchema,
  PickersRecordSchema,
  PickersStockSchema,
  pickersHash,
  pickersPairKey,
  pickersPairs,
  type PickersNativeRow,
  type PickersRecord,
} from "./pickers-parser";
import { transformPickersRecord } from "./pickers-transform";
import {
  PICKERS_APP_URL,
  PICKERS_CONFIG_URL,
  PICKERS_INVENTORY_URL,
  PICKERS_LOCATION_ID,
  PICKERS_SEARCH_URL,
  PICKERS_YARD,
  PICKERS_SITES,
  PICKERS_DEFAULT_SITE,
  type PickersSite,
} from "./pickers-yard-metadata";
import { vinplusQuery } from "./vinplus-protocol";
import { SourceValidationPolicy } from "./source-validation";

export const PICKERS_MAX_CURSOR_BYTES = 1024 * 1024;
export const PICKERS_POLICY_HASH = pickersHash({
  version: 1,
  source: "pickers",
  yard: PICKERS_YARD,
  scope: {
    yardId: PICKERS_SCOPE.yardId,
    location: PICKERS_LOCATION_ID,
    yardName: PICKERS_SCOPE.yardName,
    sourceSystem: PICKERS_SCOPE.sourceSystem,
  },
  urls: [
    PICKERS_INVENTORY_URL,
    PICKERS_APP_URL,
    PICKERS_CONFIG_URL,
    PICKERS_SEARCH_URL,
  ],
  authority: "native-active-whole-ymm-v1",
  optional: "bounded-evidence-null-v1",
  dates: "native-calendar-api-literal-v1",
  grammar: "direct-eight-cell-full-row-provenance-v1",
  vendorState: "TX",
  physicalState: "AR",
  emission: "terminal-only-v1",
});
const integer = z.number().int().nonnegative().safe();
const disposition = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("available"),
      vin: z.string(),
      canonicalHash: PickersHashSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("incomplete"),
      vin: z.string().nullable(),
      reason: z.literal("invalid-required-fields"),
    })
    .strict(),
  z
    .object({
      status: z.literal("quarantined"),
      vin: z.string().nullable(),
      reason: z.literal("active-scope-unproven"),
    })
    .strict(),
]);
const entrySchema = z
  .object({
    record: PickersRecordSchema,
    firstQuery: integer.max(PICKERS_MAX_QUERIES - 1),
    nativeHash: PickersHashSchema.nullable(),
    disposition,
  })
  .strict();
export type PickersEntry = z.infer<typeof entrySchema>;
const member = z
  .object({ stock: PickersStockSchema, hash: PickersHashSchema })
  .strict();
const receiptSchema = z
  .object({
    kind: z.enum(["opening", "query", "closing", "bookend"]),
    index: integer.max(PICKERS_MAX_QUERIES - 1),
    payloadHash: PickersHashSchema,
    bodyHash: PickersHashSchema,
    comparisonHash: PickersHashSchema.optional(),
    bytes: integer.max(4 * 1024 * 1024),
    members: z.array(member).max(PICKERS_MAX_STOCKS),
    own: z
      .array(z.object({ stock: PickersStockSchema, hit: z.boolean() }).strict())
      .max(PICKERS_MAX_NATIVE_STOCKS),
    newStocks: integer.max(PICKERS_MAX_STOCKS),
    overlap: integer.max(PICKERS_MAX_STOCKS),
    prefix: PickersHashSchema,
  })
  .strict();
export type PickersReceipt = z.infer<typeof receiptSchema>;
const guardSchema = z
  .object({
    kind: z.enum(["owner", "app", "inventory", "config"]),
    atControl: integer.max(2 * PICKERS_MAX_MAKES + PICKERS_MAX_QUERIES + 2),
    bodyHash: PickersHashSchema,
    bytes: integer.max(4 * 1024 * 1024),
    semanticHash: PickersHashSchema,
  })
  .strict();
export type PickersGuard = z.infer<typeof guardSchema>;
const stateSchema = z
  .object({
    siteCode: z
      .enum(["pickers-texarkana", "pickers-longview", "pickers-reno"])
      .optional(),
    scopeHash: PickersHashSchema,
    ownerHash: PickersHashSchema,
    appHash: PickersHashSchema,
    configHash: PickersHashSchema,
    makes: z.array(z.string().min(1).max(200)).min(1).max(PICKERS_MAX_MAKES),
    pairs: z.array(PickersPairSchema).max(PICKERS_MAX_QUERIES),
    native: z.array(PickersNativeRowSchema).max(PICKERS_MAX_NATIVE_STOCKS),
    entries: z.array(entrySchema).max(PICKERS_MAX_STOCKS),
    missing: z
      .array(
        z
          .object({
            stock: PickersStockSchema,
            nativeHash: PickersHashSchema,
            absenceHash: PickersHashSchema,
          })
          .strict(),
      )
      .max(PICKERS_MAX_NATIVE_STOCKS),
    receipts: z
      .array(receiptSchema)
      .max(2 * PICKERS_MAX_MAKES + PICKERS_MAX_QUERIES + 2),
    guards: z.array(guardSchema).min(4).max(PICKERS_MAX_REQUESTS),
    requests: integer.max(PICKERS_MAX_REQUESTS),
    bytes: integer.max(PICKERS_MAX_RESPONSE_BYTES),
    rawSelectorOccurrences: integer.max(PICKERS_MAX_OCCURRENCES),
    queryOverlapOccurrences: integer.max(PICKERS_MAX_OCCURRENCES),
  })
  .strict();
export type PickersState = z.infer<typeof stateSchema>;
const proofSchema = z
  .object({
    nativeHash: PickersHashSchema,
    queryPrefix: PickersHashSchema,
    closingPrefix: PickersHashSchema,
    terminalPrefix: PickersHashSchema,
    canonicalHash: PickersHashSchema,
    presenceHash: PickersHashSchema,
    unionHash: PickersHashSchema,
    processed: integer,
    emitted: integer,
    rejected: integer,
    excluded: z.literal(0),
    duplicateVehicles: z.literal(0),
  })
  .strict();
export type PickersProof = z.infer<typeof proofSchema>;
const common = {
  source: z.literal("pickers"),
  version: z.literal(1),
  progressHash: PickersHashSchema,
  state: stateSchema,
};
const rawCursorSchema = z.discriminatedUnion("phase", [
  z
    .object({
      source: z.literal("pickers"),
      version: z.literal(1),
      phase: z.literal("start"),
    })
    .strict(),
  z
    .object({
      ...common,
      phase: z.literal("native-opening"),
      next: integer.max(PICKERS_MAX_MAKES - 1),
    })
    .strict(),
  z
    .object({
      ...common,
      phase: z.literal("queries"),
      next: integer.max(PICKERS_MAX_QUERIES - 1),
    })
    .strict(),
  z
    .object({
      ...common,
      phase: z.literal("native-closing"),
      next: integer.max(PICKERS_MAX_MAKES - 1),
    })
    .strict(),
  z
    .object({ ...common, phase: z.literal("bookends"), next: integer.max(1) })
    .strict(),
  z
    .object({ ...common, phase: z.literal("complete"), proof: proofSchema })
    .strict(),
]);
type RawCursor = z.infer<typeof rawCursorSchema>;
type ActivePhase = Exclude<RawCursor["phase"], "start" | "complete">;

export function pickersEntry(
  record: PickersRecord,
  native: PickersNativeRow | null,
  firstQuery: number,
  site: PickersSite = PICKERS_DEFAULT_SITE,
): PickersEntry {
  const result = transformPickersRecord(native, record, site);
  if (result.status === "incomplete" && result.reason === "missing-enrichment")
    throw new Error("API entry cannot have a missing-enrichment disposition");
  return {
    record,
    firstQuery,
    nativeHash: native ? pickersHash(native) : null,
    disposition:
      result.status === "available"
        ? {
            status: "available",
            vin: result.vehicle.vin,
            canonicalHash: pickersHash(result.vehicle),
          }
        : result.status === "incomplete"
          ? {
              status: "incomplete",
              vin: result.vin,
              reason: "invalid-required-fields",
            }
          : result,
  };
}
export function pickersScopeHash(
  state: Pick<
    PickersState,
    "siteCode" | "ownerHash" | "appHash" | "configHash" | "makes"
  >,
): string {
  // Absence is the original Texarkana v1 shape, preserving saved checkpoints.
  const { siteCode, ...scope } = state;
  return pickersHash({
    policy: PICKERS_POLICY_HASH,
    ...(siteCode && siteCode !== "pickers-texarkana"
      ? { site: PICKERS_SITES[siteCode] }
      : {}),
    ...scope,
  });
}
export function pickersPayload(
  kind: PickersReceipt["kind"],
  index: number,
  state: PickersState,
): unknown {
  if (kind === "opening" || kind === "closing") {
    const make = state.makes[index];
    if (make === undefined)
      throw new Error("Native control index is outside make directory");
    return { VehicleMake: make, VehicleModel: "" };
  }
  const pair =
    state.pairs[
      kind === "bookend" ? (index === 0 ? 0 : state.pairs.length - 1) : index
    ];
  if (!pair) throw new Error("Public control index is outside pair directory");
  return {
    ...vinplusQuery(
      pickersScope(PICKERS_SITES[state.siteCode ?? "pickers-texarkana"]),
      pair,
    ),
    location_id:
      PICKERS_SITES[state.siteCode ?? "pickers-texarkana"].locationId,
  };
}
export function pickersReceipt(
  state: PickersState,
  input: Omit<PickersReceipt, "prefix">,
): PickersReceipt {
  return {
    ...input,
    prefix: pickersHash({
      previous: state.receipts.at(-1)?.prefix ?? state.scopeHash,
      ...input,
    }),
  };
}
export function pickersMissing(state: PickersState): PickersState["missing"] {
  const seen = new Set(state.entries.map((entry) => entry.record.stock));
  const absenceHash = state.receipts
    .filter((receipt) => receipt.kind === "query")
    .at(-1)?.prefix;
  if (!absenceHash)
    throw new Error("Missing-enrichment decision requires all query receipts");
  return state.native
    .filter((row) => !seen.has(row.stock))
    .map((row) => ({
      stock: row.stock,
      nativeHash: pickersHash(row),
      absenceHash,
    }));
}
export function pickersTerminal(state: PickersState) {
  const rows = new Map(state.native.map((row) => [row.stock, row]));
  const records = new Map(
    state.entries.map((entry) => [entry.record.stock, entry.record]),
  );
  const stocks = [...new Set([...rows.keys(), ...records.keys()])].sort();
  const ledger = stocks.map((stock) => ({
    stock,
    result: transformPickersRecord(
      rows.get(stock) ?? null,
      records.get(stock) ?? null,
      PICKERS_SITES[state.siteCode ?? "pickers-texarkana"],
    ),
  }));
  const vehicles = ledger.flatMap(({ result }) =>
    result.status === "available" ? [result.vehicle] : [],
  );
  const presence = ledger
    .flatMap(({ result }) =>
      result.status !== "available" && result.vin ? [result.vin] : [],
    )
    .sort();
  const proof: PickersProof = {
    nativeHash: pickersHash(state.native),
    queryPrefix:
      state.receipts.filter((receipt) => receipt.kind === "query").at(-1)
        ?.prefix ?? state.scopeHash,
    closingPrefix:
      state.receipts.filter((receipt) => receipt.kind === "closing").at(-1)
        ?.prefix ?? state.scopeHash,
    terminalPrefix: state.receipts.at(-1)?.prefix ?? state.scopeHash,
    canonicalHash: pickersHash(vehicles),
    presenceHash: pickersHash(presence),
    unionHash: pickersHash(ledger),
    processed: stocks.length,
    emitted: vehicles.length,
    rejected: stocks.length - vehicles.length,
    excluded: 0,
    duplicateVehicles: 0,
  };
  return { vehicles, presence, proof };
}
function progressHash(cursor: Exclude<RawCursor, { phase: "start" }>): string {
  return pickersHash({
    source: cursor.source,
    version: cursor.version,
    phase: cursor.phase,
    state: cursor.state,
    ...(cursor.phase === "complete"
      ? { proof: cursor.proof }
      : { next: cursor.next }),
  });
}
const same = (left: unknown, right: unknown) =>
  pickersHash(left) === pickersHash(right);
function verify(cursor: Exclude<RawCursor, { phase: "start" }>): void {
  const state = cursor.state;
  function fail(message: string): never {
    throw new Error(message);
  }
  if (
    cursor.progressHash !== progressHash(cursor) ||
    state.scopeHash !==
      pickersScopeHash({
        siteCode: state.siteCode,
        ownerHash: state.ownerHash,
        appHash: state.appHash,
        configHash: state.configHash,
        makes: state.makes,
      }) ||
    new Set(state.makes).size !== state.makes.length
  )
    fail("Checkpoint progress or source scope changed");
  const rows = new Map(state.native.map((row) => [row.stock, row]));
  const entries = new Map(
    state.entries.map((entry) => [entry.record.stock, entry]),
  );
  if (
    rows.size !== state.native.length ||
    entries.size !== state.entries.length ||
    new Set([...rows.keys(), ...entries.keys()]).size > PICKERS_MAX_STOCKS
  )
    fail("Checkpoint stock ledger is duplicated or oversized");
  const vins = new Map<string, string>();
  for (const entry of state.entries) {
    if (
      !same(
        entry,
        pickersEntry(
          entry.record,
          rows.get(entry.record.stock) ?? null,
          entry.firstQuery,
          PICKERS_SITES[state.siteCode ?? "pickers-texarkana"],
        ),
      )
    )
      fail(
        "Checkpoint full entry, native binding, disposition or canonical projection changed",
      );
    const vin = entry.disposition.vin;
    if (vin && vins.has(vin)) fail("Distinct stocks reuse one valid identity");
    if (vin) vins.set(vin, entry.record.stock);
  }
  const opening = state.receipts.filter(
    (receipt) => receipt.kind === "opening",
  ).length;
  const queries = state.receipts.filter(
    (receipt) => receipt.kind === "query",
  ).length;
  const closing = state.receipts.filter(
    (receipt) => receipt.kind === "closing",
  ).length;
  const bookends = state.receipts.filter(
    (receipt) => receipt.kind === "bookend",
  ).length;
  const expectedCounts =
    cursor.phase === "native-opening"
      ? [cursor.next, 0, 0, 0]
      : cursor.phase === "queries"
        ? [state.makes.length, cursor.next, 0, 0]
        : cursor.phase === "native-closing"
          ? [state.makes.length, state.pairs.length, cursor.next, 0]
          : cursor.phase === "bookends"
            ? [
                state.makes.length,
                state.pairs.length,
                state.makes.length,
                cursor.next,
              ]
            : [state.makes.length, state.pairs.length, state.makes.length, 2];
  if (
    !same([opening, queries, closing, bookends], expectedCounts) ||
    (cursor.phase === "native-opening" && cursor.next >= state.makes.length) ||
    (cursor.phase === "queries" && cursor.next >= state.pairs.length)
  )
    fail(
      "Checkpoint phase does not prove its exact completed directory prefix",
    );
  if (cursor.phase === "native-opening") {
    if (state.pairs.length || state.entries.length || state.missing.length)
      fail("Opening cursor carries premature query state");
  } else if (
    !state.native.length ||
    !state.pairs.length ||
    !same(state.pairs, pickersPairs(state.native))
  )
    fail("Checkpoint native table and exact pair directory disagree");
  const nativeOrder = [...state.native].sort(
    (a, b) => a.makeIndex - b.makeIndex || a.ordinal - b.ordinal,
  );
  if (
    !same(nativeOrder, state.native) ||
    state.native.some(
      (row) =>
        row.makeIndex >= opening || row.make !== state.makes[row.makeIndex],
    )
  )
    fail("Checkpoint native rows are outside their exact make controls");
  let previous = state.scopeHash;
  let raw = 0,
    overlap = 0;
  const encountered = new Set<string>();
  const order = ["opening", "query", "closing", "bookend"] as const;
  let position = 0;
  for (const [kind, count] of order.map(
    (kind, index) => [kind, expectedCounts[index] ?? 0] as const,
  )) {
    for (let index = 0; index < count; index++) {
      const receipt = state.receipts[position++];
      if (
        !receipt ||
        receipt.kind !== kind ||
        receipt.index !== index ||
        receipt.payloadHash !== pickersHash(pickersPayload(kind, index, state))
      )
        fail("Missing, duplicated, reordered or transplanted control receipt");
      const { prefix, ...input } = receipt;
      if (prefix !== pickersHash({ previous, ...input }))
        fail("Control receipt prefix changed");
      previous = receipt.prefix;
      if (
        new Set(receipt.members.map((item) => item.stock)).size !==
        receipt.members.length
      )
        fail("Receipt repeats a stock");
      if (kind === "opening" || kind === "closing") {
        const ownRows = state.native.filter((row) => row.makeIndex === index);
        if (
          ownRows.some((row, ordinal) => row.ordinal !== ordinal) ||
          !same(
            receipt.members,
            ownRows.map((row) => ({
              stock: row.stock,
              hash: pickersHash(row),
            })),
          ) ||
          receipt.own.length ||
          receipt.newStocks !== (kind === "opening" ? ownRows.length : 0) ||
          receipt.overlap
        )
          fail("Native receipt does not bind complete ordered rows and fields");
      } else {
        const queryIndex =
          kind === "bookend"
            ? index === 0
              ? 0
              : state.pairs.length - 1
            : index;
        const pair = state.pairs[queryIndex];
        if (!pair) fail("Receipt has no exact query");
        const members = new Set(receipt.members.map((item) => item.stock));
        const expectedOwn = state.native
          .filter((row) => pickersPairKey(row) === pickersPairKey(pair))
          .map((row) => ({ stock: row.stock, hit: members.has(row.stock) }));
        if (!same(receipt.own, expectedOwn))
          fail("Receipt own-stock hits or gaps changed");
        let newStocks = 0;
        for (const item of receipt.members) {
          const entry = entries.get(item.stock);
          if (
            !entry ||
            item.hash !== pickersHash(entry) ||
            entry.firstQuery > queryIndex
          )
            fail(
              "Receipt member does not bind its complete entry or first query",
            );
          if (kind === "query" && !encountered.has(item.stock)) {
            if (entry.firstQuery !== index)
              fail("First query association changed");
            encountered.add(item.stock);
            newStocks++;
          }
        }
        if (kind === "query") {
          raw += receipt.members.length;
          overlap += receipt.members.length - newStocks;
          if (
            receipt.newStocks !== newStocks ||
            receipt.overlap !== receipt.members.length - newStocks
          )
            fail("Query new-stock or overlap counts changed");
        } else {
          const original = state.receipts.find(
            (item) => item.kind === "query" && item.index === queryIndex,
          );
          if (
            !original ||
            (receipt.comparisonHash ?? receipt.bodyHash) !==
              (original.comparisonHash ?? original.bodyHash) ||
            !same(receipt.members, original.members) ||
            receipt.newStocks ||
            receipt.overlap
          )
            fail("Closing exact-query bookend changed");
        }
      }
    }
  }
  if (
    encountered.size !== entries.size ||
    raw !== state.rawSelectorOccurrences ||
    overlap !== state.queryOverlapOccurrences
  )
    fail("Checkpoint API ledger or raw provenance counts do not reconcile");
  const afterQueries =
    cursor.phase === "native-closing" ||
    cursor.phase === "bookends" ||
    cursor.phase === "complete";
  if (!same(state.missing, afterQueries ? pickersMissing(state) : []))
    fail("Missing-enrichment dispositions lack complete absence evidence");
  if (
    state.requests !== state.guards.length + state.receipts.length ||
    state.bytes !==
      [...state.guards, ...state.receipts].reduce(
        (sum, item) => sum + item.bytes,
        0,
      )
  )
    fail("Checkpoint HTTP request or response-byte costs changed");
  const initialKinds = state.guards.slice(0, 4).map((guard) => guard.kind);
  if (!same(initialKinds, ["owner", "app", "inventory", "config"]))
    fail("Bootstrap ownership guards are incomplete");
  for (const guard of state.guards) {
    const expected =
      guard.kind === "owner"
        ? state.ownerHash
        : guard.kind === "app"
          ? state.appHash
          : guard.kind === "config"
            ? state.configHash
            : pickersHash(state.makes);
    if (
      guard.semanticHash !== expected ||
      guard.atControl > state.receipts.length
    )
      fail("Checkpoint scope guard changed or has an impossible position");
  }
  const resumeGuards = state.guards.slice(
    4,
    cursor.phase === "complete" ? -2 : undefined,
  );
  let lastGuardPosition = 0;
  const guardPositions = new Set<number>();
  if (
    state.guards.slice(0, 4).some((guard) => guard.atControl !== 0) ||
    resumeGuards.length % 2
  )
    fail("Checkpoint bootstrap or paired resume guards are incomplete");
  for (let index = 0; index < resumeGuards.length; index += 2) {
    const inventory = resumeGuards[index],
      config = resumeGuards[index + 1];
    if (
      !inventory ||
      !config ||
      inventory.kind !== "inventory" ||
      config.kind !== "config" ||
      inventory.atControl !== config.atControl ||
      inventory.atControl <= lastGuardPosition ||
      inventory.atControl - lastGuardPosition > 32
    )
      fail("Checkpoint resume guards do not cover each bounded chunk in order");
    lastGuardPosition = inventory.atControl;
    guardPositions.add(lastGuardPosition);
  }
  const boundaries = [
    state.makes.length,
    state.makes.length + state.pairs.length,
    2 * state.makes.length + state.pairs.length,
  ];
  if (
    state.receipts.length - lastGuardPosition > 32 ||
    boundaries.some(
      (boundary) =>
        boundary < state.receipts.length && !guardPositions.has(boundary),
    )
  )
    fail("Checkpoint data controls skip a phase or bounded chunk resume guard");
  if (cursor.phase === "complete") {
    if (!same(cursor.proof, pickersTerminal(state).proof))
      fail("Terminal canonical, union or presence proof changed");
    const ending = state.guards.slice(-2);
    if (
      !same(
        ending.map((guard) => guard.kind),
        ["owner", "app"],
      ) ||
      ending.some((guard) => guard.atControl !== state.receipts.length)
    )
      fail("Terminal ownership guards are incomplete");
    if (
      !cursor.proof.emitted ||
      cursor.proof.rejected / cursor.proof.processed >
        SourceValidationPolicy.maximumRejectionRatio
    )
      fail(
        "Terminal checkpoint exceeds the unchanged rejection limit or has no eligible donors",
      );
  }
}
export const PickersCursorSchema = rawCursorSchema.superRefine(
  (cursor, context) => {
    if (cursor.phase === "start") return;
    try {
      verify(cursor);
    } catch (cause) {
      context.addIssue({
        code: "custom",
        message:
          cause instanceof Error ? cause.message : "Invalid Pickers checkpoint",
      });
    }
  },
);
export type PickersCursor = z.infer<typeof PickersCursorSchema>;
function bounded(serialized: string): string {
  if (Buffer.byteLength(serialized) > PICKERS_MAX_CURSOR_BYTES)
    throw new Error(
      "Pickers checkpoint exceeds 1 MiB; prior checkpoint and inventory are preserved. Inspect source growth before retrying.",
    );
  return serialized;
}
export const PickersCursor = {
  initial: { source: "pickers", version: 1, phase: "start" },
  checkpoint(
    phase: ActivePhase,
    next: number,
    state: PickersState,
  ): PickersCursor {
    const cursor = {
      source: "pickers",
      version: 1,
      phase,
      next,
      state,
    } as const;
    const parsed = PickersCursorSchema.parse({
      ...cursor,
      progressHash: pickersHash(cursor),
    });
    PickersCursor.serialize(parsed);
    return parsed;
  },
  complete(state: PickersState): PickersCursor {
    const cursor = {
      source: "pickers",
      version: 1,
      phase: "complete",
      state,
      proof: pickersTerminal(state).proof,
      progressHash: "",
    } as const;
    const parsed = PickersCursorSchema.parse({
      ...cursor,
      progressHash: progressHash(cursor),
    });
    PickersCursor.serialize(parsed);
    return parsed;
  },
  parse(serialized: string): PickersCursor {
    bounded(serialized);
    let value: unknown = JSON.parse(serialized);
    const compressed = z
      .object({
        encoding: z.literal("gzip-base64"),
        data: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
      })
      .strict()
      .safeParse(value);
    if (compressed.success) {
      value = JSON.parse(
        gunzipSync(Buffer.from(compressed.data.data, "base64"), {
          maxOutputLength: 4 * PICKERS_MAX_CURSOR_BYTES,
        }).toString("utf8"),
      );
    }
    const payload = z
      .object({ source: z.literal("pickers").optional() })
      .passthrough()
      .parse(value);
    return PickersCursorSchema.parse({ ...payload, source: "pickers" });
  },
  serialize(cursor: PickersCursor): string {
    const parsed = PickersCursorSchema.parse(cursor);
    const payload = Object.fromEntries(
      Object.entries(parsed).filter(([key]) => key !== "source"),
    );
    const wire = JSON.stringify(payload);
    if (Buffer.byteLength(wire) > 4 * PICKERS_MAX_CURSOR_BYTES)
      throw new Error(
        "Pickers decoded checkpoint exceeds 4 MiB; prior checkpoint and inventory are preserved",
      );
    // Keep the durable 1 MiB limit and every original field. Larger yards need
    // compression, with a separate bounded decode to reject compressed bombs.
    return bounded(
      Buffer.byteLength(wire) <= PICKERS_MAX_CURSOR_BYTES
        ? wire
        : JSON.stringify({
            encoding: "gzip-base64",
            data: gzipSync(wire).toString("base64"),
          }),
    );
  },
} as const;
