import { z } from "zod";
import type { UrgiisTenant } from "./urgiis-tenant";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import { UrgiisBadgeDriftSchema, urgiisBadgeLimit } from "./urgiis-closing";
import {
  UrgiisEntrySchema,
  urgiisTasks,
  urgiisFingerprint,
  validateUrgiisEntry,
} from "./urgiis-traversal";

export const URGIIS_MAX_CURSOR_BYTES = 32 * 1024 * 1024;
export const URGIIS_MAX_REQUESTS = 30_000;
const base = {
  source: z.literal("urgiis"),
  version: z.literal(1),
  scope: z.string(),
  requests: z.number().int().min(0).max(URGIIS_MAX_REQUESTS),
  bytes: z
    .number()
    .int()
    .min(0)
    .max(8 * 1024 * 1024 * 1024),
  completed: z
    .array(
      z
        .object({ code: z.string(), accepted: z.number().int().positive() })
        .strict(),
    )
    .max(100),
};
const working = {
  ...base,
  entries: z.array(UrgiisEntrySchema).max(12_000),
  closed: z.number().int().min(0).max(1026),
  // Older v1 checkpoints required exact badge equality, so omitted drift is zero.
  badgeDrift: UrgiisBadgeDriftSchema.optional(),
};
const schema = z.discriminatedUnion("phase", [
  z.object({ ...working, phase: z.literal("opening") }).strict(),
  z.object({ ...working, phase: z.literal("closing") }).strict(),
  z.object({ ...working, phase: z.literal("ready") }).strict(),
  z.object({ ...base, phase: z.literal("complete") }).strict(),
]);
type State = z.infer<typeof schema>;
export type UrgiisCursor = State & { checksum: string };
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
  if (state.scope !== urgiisFingerprint(tenants))
    throw new Error("IIS tenant qualification changed; restart from the owner");
  state.completed.forEach((done, i) => {
    const tenant = tenants[i];
    if (
      !tenant ||
      done.code !== tenant.code ||
      done.accepted < tenant.minimumInventory
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
        ? state.entries.length >= tasks.length || state.closed !== 0
        : state.entries.length !== tasks.length ||
          state.closed >
            (state.entries[1]?.kind === "makes"
              ? state.entries[1].controls.length + 2
              : 0))
    )
      throw new Error(
        "IIS checkpoint has an incomplete or noncontiguous frontier",
      );
    state.entries.forEach((entry, i) => {
      const task = tasks[i];
      if (!task) throw new Error("IIS checkpoint has excess evidence");
      validateUrgiisEntry(entry, task, tenant);
    });
    const closingTasks = tasks.filter(
      (t) => t.kind === "owner" || t.kind === "makes" || t.kind === "menu",
    );
    if (
      (state.phase === "closing" && state.closed >= closingTasks.length) ||
      (state.phase === "ready" && state.closed !== closingTasks.length)
    )
      throw new Error("IIS closing frontier is inconsistent");
    const currentRequests = state.entries.length + state.closed;
    if (
      state.requests < currentRequests ||
      state.bytes < state.entries.reduce((n, e) => n + e.bytes, 0)
    )
      throw new Error("IIS checkpoint request/body accounting is inconsistent");
  }
  const cursor = { ...state, checksum: urgiisFingerprint(state) };
  if (
    new TextEncoder().encode(JSON.stringify(cursor)).byteLength >
    URGIIS_MAX_CURSOR_BYTES
  )
    throw new Error("IIS checkpoint exceeds 32 MiB; preserve prior inventory");
  return cursor;
}
function parse(
  input: unknown,
  tenants: readonly UrgiisTenant[] = URGIIS_TENANTS,
) {
  const signed = z.object({ checksum: z.string() }).passthrough().parse(input);
  const { checksum, ...state } = signed;
  const cursor = checkpoint(state, tenants);
  if (cursor.checksum !== checksum)
    throw new Error("IIS checkpoint checksum changed");
  return cursor;
}
export const UrgiisCursor = {
  initial(tenants: readonly UrgiisTenant[] = URGIIS_TENANTS): UrgiisCursor {
    return checkpoint(
      {
        source: "urgiis",
        version: 1,
        scope: urgiisFingerprint(tenants),
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
  parse,
  serialize(
    cursor: UrgiisCursor,
    tenants: readonly UrgiisTenant[] = URGIIS_TENANTS,
  ) {
    return JSON.stringify(parse(cursor, tenants));
  },
  fromWire(raw: string, tenants: readonly UrgiisTenant[] = URGIIS_TENANTS) {
    if (new TextEncoder().encode(raw).byteLength > URGIIS_MAX_CURSOR_BYTES)
      throw new Error("IIS checkpoint wire exceeds 32 MiB");
    return parse(JSON.parse(raw), tenants);
  },
} as const;
