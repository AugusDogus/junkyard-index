import { urgiisArrivalsCoverage, urgiisDonorIdentity } from "./urgiis-arrivals";
import { z } from "zod";
import { urgiisModelCoverage } from "./urgiis-model-coverage";
import type { UrgiisTenant } from "./urgiis-tenant";
import {
  UrgiisEntrySchema,
  urgiisFingerprint,
  urgiisTasks,
  validateUrgiisEntry,
  type UrgiisEntry,
  type UrgiisTask,
} from "./urgiis-traversal";
import type { UrgiisRecord } from "./urgiis-schema";

export const URGIIS_DAY_MS = 24 * 60 * 60 * 1000;
export const URGIIS_SWEEP_MS = 7 * URGIIS_DAY_MS;
// Reserve one day for a run to finish before the seven-day evidence ceiling.
const carryMs = 6 * URGIIS_DAY_MS;
// A freshly read model refreshes its donors' seller details once they are this
// old. That model's next read comes within the carry limit, so no seller
// evidence reaches sellerMaxMs. Other model reads reuse unchanged details.
const sellerRefreshMs = 21 * URGIIS_DAY_MS;
const sellerMaxMs = sellerRefreshMs + carryMs;
// Bump this whenever admission, traversal or interpretation of cached evidence changes.
const contract = "incremental-census-v6";
const tenantSchema = z
  .object({
    code: z.string(),
    scope: z.string(),
    acceptedAt: z.number().int().nonnegative(),
    entries: z.array(UrgiisEntrySchema).max(12_000),
  })
  .strict();
const schema = z
  .object({
    version: z.literal(1),
    tenants: z.array(tenantSchema).max(100),
  })
  .strict();
export type UrgiisCensus = z.infer<typeof schema>;
export type UrgiisTenantCensus = z.infer<typeof tenantSchema>;
const scope = (tenant: UrgiisTenant) => urgiisFingerprint({ contract, tenant });

function validate(
  census: UrgiisTenantCensus,
  tenant: UrgiisTenant,
  now: number,
) {
  if (census.scope !== scope(tenant) || census.acceptedAt > now)
    throw new Error(
      "IIS census contract changed or publication is in the future",
    );
  const tasks = urgiisTasks(census.entries, tenant);
  if (tasks.length !== census.entries.length)
    throw new Error("IIS accepted census has an incomplete native graph");
  if (urgiisModelCoverage(census.entries).blocked)
    throw new Error(
      "IIS accepted census exceeds the platform-unreachable allowance",
    );
  census.entries.forEach((entry, index) => {
    const task = tasks[index];
    if (!task) throw new Error("IIS accepted census has excess evidence");
    validateUrgiisEntry(entry, task, tenant);
    if (
      (entry.kind === "model" &&
        (entry.freshness.kind === "retry" ||
          entry.freshness.readAt > census.acceptedAt)) ||
      (entry.kind === "detail" && entry.readAt > census.acceptedAt)
    )
      throw new Error("IIS accepted evidence is dated in the future");
  });
}
function previousModel(
  task: UrgiisTask,
  previous: UrgiisTenantCensus | undefined,
) {
  if (task.kind !== "model" || !previous) return undefined;
  // Literal paths and labels must still agree across days.
  const menu = previous.entries.find(
    (e) =>
      e.kind === "menu" && e.url === new URL(task.make.path, task.url).href,
  );
  const model =
    menu && "controls" in menu
      ? menu.controls.find((c) => c.path === task.model.path)
      : undefined;
  const makes = previous.entries.find((e) => e.kind === "makes");
  const make =
    makes && "controls" in makes
      ? makes.controls.find((c) => c.path === task.make.path)
      : undefined;
  const entry = previous.entries.find(
    (e) => e.kind === "model" && e.url === task.url,
  );
  return entry?.kind === "model" &&
    model &&
    make &&
    model.label === task.model.label &&
    make.label === task.make.label
    ? { entry, model }
    : undefined;
}

// One slice per carry day: a model's slice comes back on the day its carry
// expires, so the slice read and the age read are the same read.
const slices = carryMs / URGIIS_DAY_MS;
/** Balanced native-control slices start on the first incremental day, even when
 * bootstrap read every page at the same time. Age remains an independent ceiling. */
export function urgiisSweepDue(index: number, now: number, readAt: number) {
  const day = Math.floor(now / URGIIS_DAY_MS);
  const readDay = Math.floor(readAt / URGIIS_DAY_MS);
  if (now - readAt >= carryMs) return true;
  if (readDay >= day) return false;
  const slice = index % slices;
  if (slice === day % slices) return true;
  // A slice day with no run since this read (the rest of a multi-day cold
  // census, or an outage) would leave the model to its age read, on the same
  // day as every other missed slice. Spread those catch-up reads over the
  // four days before that age read. Read on schedule, a model has no missed
  // slice day, so steady state is unchanged.
  const lastSliceDay = day - ((day - slice) % slices);
  return (
    lastSliceDay > readDay &&
    day - readDay >= slices - (Math.floor(index / slices) % 4)
  );
}
export function urgiisCarry(
  task: UrgiisTask,
  entries: readonly UrgiisEntry[],
  previous: UrgiisTenantCensus | undefined,
  now: number,
): UrgiisEntry | undefined {
  if (!previous) return undefined;
  if (task.kind === "detail") {
    // Reuse a seller only for the same donor: its detail URL binds stock and
    // year, and every previous card for that URL claimed the same single VIN.
    // The previous task kept one of those cards, so its seller page was
    // checked against this VIN; any disagreeing card forces a fresh read.
    const detail = previous.entries.find(
      (e) => e.kind === "detail" && e.url === task.url,
    );
    if (detail?.kind !== "detail") return undefined;
    const cards = previous.entries.flatMap((e) =>
      e.kind === "model" || e.kind === "arrivals"
        ? e.records.filter((r) => r.destinations.includes(task.url))
        : [],
    );
    const sameDonor =
      cards.length > 0 &&
      cards.every((r) => {
        const vins = new Set(
          r.vins.map((v) => v.trim().toUpperCase()).filter(Boolean),
        );
        return vins.size === 1 && vins.has(task.vin);
      });
    const models = entries
      .filter((e) => e.kind === "model")
      .filter((e) => e.records.some((r) => r.destinations.includes(task.url)));
    const fresh = models.some((e) => e.freshness.kind === "read");
    // Unattributed evidence keeps the earlier rule: reused only inside a
    // carried model. A seller is refreshed by a model read once it is old.
    const limit =
      detail.seller === null
        ? models.length && !fresh
          ? sellerMaxMs
          : 0
        : fresh
          ? sellerRefreshMs
          : sellerMaxMs;
    const age = now - detail.readAt;
    return sameDonor && age >= 0 && age < limit
      ? { ...detail, bytes: 0 }
      : undefined;
  }
  const before = previousModel(task, previous);
  if (
    !before ||
    task.kind !== "model" ||
    urgiisArrivalsCoverage(entries, previous).kind === "overflow"
  )
    return undefined;
  const index = entries
    .flatMap((e) => (e.kind === "menu" ? e.controls : []))
    .findIndex((c) => c.path === task.model.path);
  const arrivals = entries.find((e) => e.kind === "arrivals");
  // An arrivals-only donor already published yesterday is also known. Its
  // continued presence must not force the same unchanged page read every day.
  const prefix = task.url.replace(/\/$/, "") + "/";
  const belongs = (record: UrgiisRecord) =>
    record.destinations.some((url) => url.startsWith(prefix)) ||
    record.titles.some(
      (title) =>
        title === task.make.label + " " + task.model.label ||
        (title === task.model.label &&
          (task.model.label === task.make.label ||
            task.model.label.startsWith(task.make.label + " "))),
    );
  const previousArrivals = previous.entries.flatMap((e) =>
    e.kind === "arrivals" ? e.records.filter(belongs) : [],
  );
  const known = new Set(
    [...before.entry.records, ...previousArrivals].map(urgiisDonorIdentity),
  );
  const unknownArrival =
    arrivals?.kind === "arrivals" &&
    arrivals.records.some(
      (record) => belongs(record) && !known.has(urgiisDonorIdentity(record)),
    );
  if (
    before.model.count !== task.model.count ||
    before.entry.freshness.kind === "deferred" ||
    unknownArrival ||
    urgiisSweepDue(index, now, before.entry.freshness.readAt)
  )
    return undefined;
  return {
    ...before.entry,
    bytes: 0,
    freshness: { ...before.entry.freshness, kind: "carried" },
  };
}
export function urgiisDefer(
  task: UrgiisTask,
  entries: readonly UrgiisEntry[],
  previous: UrgiisTenantCensus | undefined,
  now: number,
) {
  const before = previousModel(task, previous);
  if (
    !before ||
    urgiisArrivalsCoverage(entries, previous).kind === "overflow" ||
    task.kind !== "model" ||
    task.model.count >= 500 ||
    now - before.entry.freshness.readAt >= carryMs
  )
    return undefined;
  return {
    ...before.entry,
    bytes: 0,
    freshness: { ...before.entry.freshness, kind: "deferred" as const },
  };
}
export const UrgiisCensus = {
  empty: (): UrgiisCensus => ({ version: 1, tenants: [] }),
  parse(
    input: unknown,
    tenants: readonly UrgiisTenant[],
    now: number,
  ): UrgiisCensus {
    const state = schema.parse(input);
    if (new Set(state.tenants.map((t) => t.code)).size !== state.tenants.length)
      throw new Error("IIS census repeats a tenant");
    for (const item of state.tenants) {
      const tenant = tenants.find((t) => t.code === item.code);
      if (!tenant) throw new Error("IIS census qualification changed");
      validate(item, tenant, now);
    }
    return state;
  },
  accept(
    state: UrgiisCensus,
    tenant: UrgiisTenant,
    entries: UrgiisEntry[],
    now: number,
  ): UrgiisCensus {
    const next = {
      code: tenant.code,
      scope: scope(tenant),
      acceptedAt: now,
      entries,
    };
    validate(next, tenant, now);
    return {
      version: 1,
      tenants: [...state.tenants.filter((t) => t.code !== tenant.code), next],
    };
  },
} as const;
