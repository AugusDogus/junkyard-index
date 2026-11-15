import { z } from "zod";
import {
  DENTON_MAX_BODY_BYTES,
  DentonResponseSchema,
  dentonSlashRedirect,
  type DentonResponse,
} from "./denton-client";
import { dentonBoundary, type DentonResult } from "./denton-html";
import {
  DentonEntrySchema,
  DentonRedirectSchema,
  dentonFingerprint,
  dentonHash,
  dentonParseEntry,
  dentonTasks,
  dentonValidateEntry,
} from "./denton-traversal";
import {
  DENTON_PRESERVED_DESTINATION_FAILURES,
  DENTON_YARD,
} from "./denton-yard-metadata";

export const DENTON_MINIMUM_INVENTORY = 2000;
export const DENTON_MAX_REQUESTS = 2048;
export const DENTON_MAX_TOTAL_BYTES = 256 * 1024 * 1024;
export const DENTON_MAX_CURSOR_BYTES = 16 * 1024 * 1024;
const prior = z.number().int().nonnegative().safe().nullable();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const schema = z
  .object({
    source: z.literal("denton"),
    version: z.literal(1),
    scope: hash,
    checksum: hash,
    phase: z.enum(["active", "complete"]),
    opening: z.array(DentonEntrySchema).max(1024),
    closing: z.array(DentonEntrySchema).max(1024),
    pending: DentonRedirectSchema.nullable(),
    requests: z.number().int().min(0).max(DENTON_MAX_REQUESTS),
    bytes: z.number().int().min(0).max(DENTON_MAX_TOTAL_BYTES),
  })
  .strict();
export type DentonCursor = z.infer<typeof schema>;
const scope = (previousAcceptedCount: number | null) =>
  dentonHash({
    contract:
      "literal-controls/all-model-closing/arrival-union/native-alias-v1",
    yard: DENTON_YARD,
    failures: DENTON_PRESERVED_DESTINATION_FAILURES,
    minimumUniqueInventory: DENTON_MINIMUM_INVENTORY,
    maximumRejectionRatio: 0.1,
    maximumDuplicateRatio: 0.25,
    minimumPreviousRunRatio: 0.5,
    previousAcceptedCount: prior.parse(previousAcceptedCount),
  });
const checksum = (state: DentonCursor) =>
  dentonHash({ ...state, checksum: undefined });
export function dentonReady(state: DentonCursor) {
  const tasks = dentonTasks(state.opening);
  return (
    state.pending === null &&
    tasks.at(-1)?.kind === "arrivals" &&
    state.opening.length === tasks.length &&
    state.closing.length === tasks.length
  );
}
export function dentonNextTask(state: DentonCursor) {
  const tasks = dentonTasks(state.opening);
  return tasks[
    state.opening.length < tasks.length
      ? state.opening.length
      : state.closing.length
  ];
}
export function dentonNextUrl(state: DentonCursor): DentonResult<string> {
  return dentonBoundary("next request", () => {
    if (state.phase === "complete" || dentonReady(state))
      throw new Error("Terminal traversal has no further requests");
    const task = dentonNextTask(state);
    if (!task)
      throw new Error("Incomplete traversal lost its next published control");
    return state.pending?.target ?? task.url;
  });
}
function validate(
  input: unknown,
  previousAcceptedCount: number | null,
): DentonCursor {
  if (Buffer.byteLength(JSON.stringify(input)) > DENTON_MAX_CURSOR_BYTES)
    throw new Error("Checkpoint exceeds the 16 MiB native corpus bound");
  const state = schema.parse(input);
  if (
    state.scope !== scope(previousAcceptedCount) ||
    state.checksum !== checksum(state)
  )
    throw new Error(
      "Checkpoint scope, prior inventory guard or integrity changed",
    );
  let requests = 0,
    bytes = 0;
  // Replay the structural prefix so a later make/model cannot fill an earlier gap.
  const prefix: DentonCursor["opening"] = [];
  for (const entry of state.opening) {
    const task = dentonTasks(prefix)[prefix.length];
    if (!task)
      throw new Error("Opening checkpoint exceeds its actual published graph");
    dentonValidateEntry(entry, task);
    account(entry.receipt, task.url);
    prefix.push(entry);
  }
  const tasks = dentonTasks(state.opening);
  const fullOpening =
    tasks.at(-1)?.kind === "arrivals" && state.opening.length === tasks.length;
  if (state.closing.length && !fullOpening)
    throw new Error("Closing checkpoint precedes complete opening details");
  state.closing.forEach((entry, index) => {
    const task = tasks[index],
      original = state.opening[index];
    if (!task || !original)
      throw new Error("Closing checkpoint exceeds its opening graph");
    dentonValidateEntry(entry, task);
    account(entry.receipt, task.url);
    if (
      task.kind !== "arrivals" &&
      dentonFingerprint(entry) !== dentonFingerprint(original)
    )
      throw new Error(
        "Closing literal controls, ownership or donor details changed",
      );
  });
  if (state.pending) {
    const task = dentonNextTask(state);
    if (
      !task ||
      dentonReady({ ...state, pending: null }) ||
      state.pending.url !== task.url ||
      !dentonSlashRedirect(task.url, state.pending.target)
    )
      throw new Error("Pending redirect is outside the next literal control");
    requests++;
    bytes += state.pending.bytes;
  }
  if (
    state.requests !== requests ||
    state.bytes !== bytes ||
    (state.phase === "complete" && !dentonReady(state))
  )
    throw new Error(
      "Checkpoint physical request/body accounting or terminal proof is inconsistent",
    );
  const modelTasks = tasks.filter((task) => task.kind === "model");
  if (
    tasks.length > 1024 ||
    modelTasks.length > 768 ||
    new Set(modelTasks.map((task) => task.url)).size !== modelTasks.length ||
    state.opening.reduce(
      (n, e) =>
        n +
        (e.kind === "model" || e.kind === "arrivals"
          ? e.page.records.length
          : 0),
      0,
    ) > 50_000
  )
    throw new Error("Checkpoint repeats or exceeds the bounded native graph");
  return state;

  function account(
    receipt: DentonCursor["opening"][number]["receipt"],
    url: string,
  ) {
    if (receipt.redirect) {
      if (
        receipt.redirect.url !== url ||
        !dentonSlashRedirect(url, receipt.redirect.target) ||
        receipt.url !== receipt.redirect.target
      )
        throw new Error(
          "Checkpoint redirect lost its original literal destination",
        );
      requests++;
      bytes += receipt.redirect.bytes;
    } else if (receipt.url !== url)
      throw new Error("Checkpoint response destination changed");
    requests++;
    bytes += receipt.bytes;
  }
}
function checkpoint(input: unknown, previousAcceptedCount: number | null) {
  const unsigned = schema.parse({
    ...z.record(z.string(), z.unknown()).parse(input),
    checksum: "0".repeat(64),
  });
  return validate(
    { ...unsigned, checksum: checksum(unsigned) },
    previousAcceptedCount,
  );
}
export const DentonCursor = {
  initial(previousAcceptedCount: number | null): DentonResult<DentonCursor> {
    return dentonBoundary("initial checkpoint", () =>
      checkpoint(
        {
          source: "denton",
          version: 1,
          scope: scope(previousAcceptedCount),
          phase: "active",
          opening: [],
          closing: [],
          pending: null,
          requests: 0,
          bytes: 0,
        },
        previousAcceptedCount,
      ),
    );
  },
  parse(input: unknown, previousAcceptedCount: number | null) {
    return dentonBoundary("checkpoint", () =>
      validate(input, previousAcceptedCount),
    );
  },
  fromWire(raw: string, previousAcceptedCount: number | null) {
    return dentonBoundary("checkpoint wire", () => {
      if (Buffer.byteLength(raw) > DENTON_MAX_CURSOR_BYTES)
        throw new Error("Checkpoint wire exceeds 16 MiB");
      return validate(JSON.parse(raw), previousAcceptedCount);
    });
  },
  serialize(state: DentonCursor, previousAcceptedCount: number | null) {
    return dentonBoundary("checkpoint serialization", () =>
      JSON.stringify(validate(state, previousAcceptedCount)),
    );
  },
  complete(state: DentonCursor, previousAcceptedCount: number | null) {
    return dentonBoundary("terminal checkpoint", () =>
      checkpoint(
        { ...validate(state, previousAcceptedCount), phase: "complete" },
        previousAcceptedCount,
      ),
    );
  },
  advance(
    input: DentonCursor,
    response: DentonResponse,
    previousAcceptedCount: number | null,
  ) {
    return dentonBoundary("native transition", () => {
      const state = validate(input, previousAcceptedCount);
      const next = dentonNextUrl(state);
      if (!next.ok) throw new Error(next.error.message);
      const result = DentonResponseSchema.parse(response),
        size = Buffer.byteLength(result.body);
      if (
        result.url !== next.value ||
        size > DENTON_MAX_BODY_BYTES ||
        state.requests >= DENTON_MAX_REQUESTS ||
        state.bytes + size > DENTON_MAX_TOTAL_BYTES
      )
        throw new Error(
          "Native response destination or whole-run request/body bound changed",
        );
      const base = {
        ...state,
        requests: state.requests + 1,
        bytes: state.bytes + size,
      };
      if (result.kind === "redirect") {
        if (state.pending || !dentonSlashRedirect(result.url, result.target))
          throw new Error(
            "Unexpected redirect, redirect chain or foreign destination",
          );
        return checkpoint(
          {
            ...base,
            pending: {
              url: result.url,
              target: result.target,
              bytes: size,
              bodyHash: dentonHash(result.body),
            },
          },
          previousAcceptedCount,
        );
      }
      if (!size) throw new Error("Native HTML document is empty");
      const task = dentonNextTask(state);
      if (!task) throw new Error("Native response has no published task");
      const entry = dentonParseEntry(
        result.body,
        task,
        {
          url: result.url,
          bytes: size,
          bodyHash: dentonHash(result.body),
          redirect: state.pending,
        },
        state.opening,
      );
      const opening = state.opening.length < dentonTasks(state.opening).length;
      return checkpoint(
        {
          ...base,
          pending: null,
          opening: opening ? [...state.opening, entry] : state.opening,
          closing: opening ? state.closing : [...state.closing, entry],
        },
        previousAcceptedCount,
      );
    });
  },
} as const;
