import { z } from "zod";
import { UrgiisControlSchema } from "./urgiis-schema";
import { UrgiisTenant } from "./urgiis-tenant";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import { UrgiisBadgeDriftSchema, urgiisBadgeLimit } from "./urgiis-closing";
import {
  UrgiisEntrySchema,
  freezeUrgiisEvidence,
  urgiisTasks,
  urgiisFingerprint,
  validateUrgiisEntry,
  type UrgiisEntry,
  type UrgiisTask,
} from "./urgiis-traversal";

/** Binds checkpoints to every tenant's qualification contract. */
const tenantScope = (tenants: readonly UrgiisTenant[]) =>
  urgiisFingerprint(tenants.map(UrgiisTenant.qualification));
export const URGIIS_MAX_CURSOR_BYTES = 16 * 1024 * 1024;
export const URGIIS_MAX_REQUESTS = 30_000;
/** Reads of one page, in separate chunks, before its failure blocks the tenant. */
export const URGIIS_PAGE_ATTEMPTS = 3;
const base = {
  source: z.literal("urgiis"),
  version: z.literal(2),
  scope: z.string(),
  startedAt: z.number().int().nonnegative().nullable(),
  // Absent on older checkpoints, which retain their one-day deadline.
  runKind: z.enum(["cold", "recovery", "incremental"]).optional(),
  retryAt: z.number().int().nonnegative().safe().optional(),
  asOf: z.number().int().nonnegative().nullable(),
  // The repository installs this pointer atomically with the snapshot checkpoint.
  statePath: z.string().min(1).nullable(),
  stateHash: z.string().nullable(),
  requests: z.number().int().min(0).max(URGIIS_MAX_REQUESTS),
  bytes: z
    .number()
    .int()
    .min(0)
    .max(8 * 1024 * 1024 * 1024),
  completed: z
    .array(
      z.union([
        z
          .object({ code: z.string(), accepted: z.number().int().positive() })
          .strict(),
        z.object({ code: z.string(), blocked: z.string().min(1) }).strict(),
      ]),
    )
    .max(100),
};
const working = {
  ...base,
  entries: z.array(UrgiisEntrySchema).max(12_000),
  closed: z.number().int().min(0).max(1026),
  // Older v1 checkpoints required exact badge equality, so omitted drift is zero.
  badgeDrift: UrgiisBadgeDriftSchema.optional(),
  closingModels: z.array(UrgiisControlSchema).max(10000).optional(),
  // The frontier page's failed reads so far; the next chunk reads it again.
  failedReads: z
    .object({
      url: z.string().max(2000),
      attempts: z
        .number()
        .int()
        .min(1)
        .max(URGIIS_PAGE_ATTEMPTS - 1),
    })
    .strict()
    .optional(),
};
const schema = z.discriminatedUnion("phase", [
  z.object({ ...working, phase: z.literal("opening") }).strict(),
  z.object({ ...working, phase: z.literal("closing") }).strict(),
  z.object({ ...working, phase: z.literal("ready") }).strict(),
  z.object({ ...base, phase: z.literal("complete") }).strict(),
]);
type State = z.infer<typeof schema>;
export type UrgiisCursor = State & { checksum: string };
const validatedCursors = new WeakMap<object, UrgiisCursor>();
const validatedTasks = new WeakMap<
  UrgiisEntry,
  { task: UrgiisTask; scope: string }
>();
const entryReceipts = new WeakMap<
  UrgiisEntry,
  { hash: string; bytes: number }
>();
function entryReceipt(entry: UrgiisEntry) {
  const cached = entryReceipts.get(entry);
  if (cached) return cached;
  // Only schema-validated, deeply frozen entries reach this boundary. A new
  // wire object is always validated and hashed before its receipt can be reused.
  const receipt = {
    hash: urgiisFingerprint(entry),
    bytes: new TextEncoder().encode(JSON.stringify(entry)).byteLength,
  };
  entryReceipts.set(entry, receipt);
  return receipt;
}
function checksum(state: State) {
  return (
    "e1-" +
    urgiisFingerprint({
      ...state,
      ...(state.phase === "complete"
        ? {}
        : { entries: state.entries.map((entry) => entryReceipt(entry).hash) }),
      statePath: undefined,
    })
  );
}
function wireBytes(cursor: UrgiisCursor) {
  if (cursor.phase === "complete")
    return new TextEncoder().encode(JSON.stringify(cursor)).byteLength;
  return (
    new TextEncoder().encode(JSON.stringify({ ...cursor, entries: [] }))
      .byteLength +
    cursor.entries.reduce((n, entry) => n + entryReceipt(entry).bytes, 0) +
    Math.max(0, cursor.entries.length - 1)
  );
}
function checkpoint(
  input: unknown,
  tenants: readonly UrgiisTenant[] = URGIIS_TENANTS,
): UrgiisCursor {
  const envelope = z
    .object({ checksum: z.string().optional() })
    .passthrough()
    .parse(input);
  const { checksum: _checksum, ...unsigned } = envelope;
  void _checksum;
  const state = schema.parse(unsigned);
  if (state.scope !== tenantScope(tenants))
    throw new Error("IIS tenant qualification changed; restart from the owner");
  if (
    (state.startedAt === null) !== (state.asOf === null) ||
    (state.startedAt !== null &&
      state.asOf !== null &&
      state.asOf < state.startedAt)
  )
    throw new Error("IIS census clock is inconsistent");
  state.completed.forEach((done, i) => {
    const tenant = tenants[i];
    if (
      !tenant ||
      done.code !== tenant.code ||
      ("accepted" in done && done.accepted < tenant.minimumInventory)
    )
      throw new Error("IIS completed tenant prefix or qualified floor changed");
  });
  if (state.phase === "complete") {
    if (state.completed.length !== tenants.length)
      throw new Error("IIS complete cursor has unread tenants");
  } else {
    const tenant = tenants[state.completed.length];
    if (!tenant) throw new Error("IIS working cursor has no next tenant");
    const tasks = urgiisTasks(state.entries, tenant);
    const drift = state.badgeDrift ?? { makes: 0, models: 0 };
    const limit = urgiisBadgeLimit(state.entries);
    if (
      drift.makes > limit ||
      drift.models > limit ||
      (state.closed < 2 && drift.makes !== 0) ||
      (state.closed < 3 && drift.models !== 0)
    )
      throw new Error(
        "IIS checkpoint badge drift exceeds its closing frontier or tenant limit",
      );
    if (
      state.entries.length > tasks.length ||
      (state.phase === "opening"
        ? (state.entries.length >= tasks.length &&
            !state.entries.some(
              (e) => e.kind === "model" && e.freshness.kind === "retry",
            )) ||
          state.closed !== 0
        : state.entries.length !== tasks.length ||
          state.closed >
            (state.entries[1]?.kind === "makes"
              ? state.entries[1].controls.length + 2
              : 0))
    )
      throw new Error(
        "IIS checkpoint has an incomplete or noncontiguous frontier",
      );
    if (
      state.phase !== "opening" &&
      state.entries.some(
        (e) => e.kind === "model" && e.freshness.kind === "retry",
      )
    )
      throw new Error("IIS pending empty model must be retried before closing");
    state.entries.forEach((entry, i) => {
      if (
        state.runKind === "cold" &&
        ((entry.kind === "model" &&
          (entry.freshness.kind === "carried" ||
            entry.freshness.kind === "deferred")) ||
          (entry.kind === "detail" && entry.bytes === 0))
      )
        throw new Error("IIS cold census cannot carry prior model evidence");
      const task = tasks[i];
      if (!task) throw new Error("IIS checkpoint has excess evidence");
      const prior = validatedTasks.get(entry);
      if (prior?.task !== task || prior.scope !== state.scope) {
        validateUrgiisEntry(entry, task, tenant);
        if (Object.isFrozen(task))
          validatedTasks.set(entry, { task, scope: state.scope });
      }
    });
    if (state.closingModels) {
      const expected = state.entries
        .filter((e) => e.kind === "menu")
        .slice(0, Math.max(0, state.closed - 2))
        .flatMap((e) => (e.kind === "menu" ? e.controls : []));
      if (
        state.closingModels.length !== expected.length ||
        state.closingModels.some(
          (c, i) =>
            c.path !== expected[i]?.path || c.label !== expected[i]?.label,
        )
      )
        throw new Error(
          "IIS closing model coverage loses its contiguous directory prefix",
        );
    }
    const closingTasks = tasks.filter(
      (t) => t.kind === "owner" || t.kind === "makes" || t.kind === "menu",
    );
    if (
      (state.phase === "closing" && state.closed >= closingTasks.length) ||
      (state.phase === "ready" && state.closed !== closingTasks.length)
    )
      throw new Error("IIS closing frontier is inconsistent");
    const currentRequests =
      state.entries.filter((e) => e.bytes > 0).length + state.closed;
    // Closing may schedule a retry for a carried empty with no current body.
    // Pending entries must be reread before closing or acceptance.
    if (
      state.entries.some(
        (e) =>
          e.kind === "model" &&
          (state.startedAt === null ||
            state.asOf === null ||
            e.freshness.readAt > state.asOf ||
            (e.freshness.kind === "retry"
              ? e.bytes > 0 && e.freshness.readAt < state.startedAt
              : e.freshness.kind === "read"
                ? e.freshness.readAt < state.startedAt || e.bytes === 0
                : e.bytes !== 0)),
      )
    )
      throw new Error("IIS model freshness is inconsistent with its run");
    // A detail read in this run is dated at its start; a reused one earlier.
    if (
      state.entries.some(
        (e) =>
          e.kind === "detail" &&
          (state.startedAt === null ||
            state.asOf === null ||
            e.readAt > state.asOf ||
            e.bytes > 0 !== e.readAt >= state.startedAt),
      )
    )
      throw new Error(
        "IIS seller detail freshness is inconsistent with its run",
      );
    if (
      state.requests < currentRequests ||
      state.bytes < state.entries.reduce((n, e) => n + e.bytes, 0)
    )
      throw new Error("IIS checkpoint request/body accounting is inconsistent");
  }
  const cursor = {
    ...state,
    checksum: checksum(state),
  };
  if (wireBytes(cursor) > URGIIS_MAX_CURSOR_BYTES)
    throw new Error("IIS checkpoint exceeds 16 MiB; preserve prior inventory");
  freezeUrgiisEvidence(cursor);
  validatedCursors.set(cursor, cursor);
  return cursor;
}
function parse(
  input: unknown,
  tenants: readonly UrgiisTenant[] = URGIIS_TENANTS,
) {
  const cached =
    input !== null && typeof input === "object"
      ? validatedCursors.get(input)
      : undefined;
  if (cached && cached.scope === tenantScope(tenants)) return cached;
  const signed = z.object({ checksum: z.string() }).passthrough().parse(input);
  const { checksum, ...state } = signed;
  const cursor = checkpoint(state, tenants);
  if (
    cursor.checksum !== checksum &&
    (checksum.startsWith("e1-") ||
      urgiisFingerprint({ ...state, statePath: undefined }) !== checksum)
  )
    throw new Error("IIS checkpoint checksum changed");
  return cursor;
}
export const UrgiisCursor = {
  initial(tenants: readonly UrgiisTenant[] = URGIIS_TENANTS): UrgiisCursor {
    return checkpoint(
      {
        source: "urgiis",
        version: 2,
        scope: tenantScope(tenants),
        startedAt: null,
        asOf: null,
        statePath: null,
        stateHash: null,
        requests: 0,
        bytes: 0,
        completed: [],
        ...(tenants.length
          ? { phase: "opening", entries: [], closed: 0 }
          : { phase: "complete" }),
      },
      tenants,
    );
  },
  checkpoint,
  nextTenant(
    cursor: UrgiisCursor,
    done: z.infer<typeof base.completed>[number],
    tenants: readonly UrgiisTenant[],
    stateHash: string,
  ): UrgiisCursor {
    const completed = [...cursor.completed, done];
    return checkpoint(
      {
        source: cursor.source,
        version: cursor.version,
        scope: cursor.scope,
        startedAt: cursor.startedAt,
        ...(cursor.runKind ? { runKind: cursor.runKind } : {}),
        asOf: cursor.asOf,
        statePath: cursor.statePath,
        requests: cursor.requests,
        bytes: cursor.bytes,
        stateHash,
        completed,
        ...(completed.length === tenants.length
          ? { phase: "complete" }
          : { phase: "opening", entries: [], closed: 0 }),
      },
      tenants,
    );
  },
  parse,
  serialize(
    cursor: UrgiisCursor,
    tenants: readonly UrgiisTenant[] = URGIIS_TENANTS,
  ) {
    return JSON.stringify(parse(cursor, tenants));
  },
  fromWire(raw: string, tenants: readonly UrgiisTenant[] = URGIIS_TENANTS) {
    if (new TextEncoder().encode(raw).byteLength > URGIIS_MAX_CURSOR_BYTES)
      throw new Error("IIS checkpoint wire exceeds 16 MiB");
    return parse(JSON.parse(raw), tenants);
  },
} as const;
