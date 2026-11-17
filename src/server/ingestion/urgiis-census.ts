import { urgiisArrivalsCoverage, urgiisDonorIdentity } from "./urgiis-arrivals";
import { z } from "zod";
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
// Bump this whenever admission, traversal or interpretation of cached evidence changes.
const contract = "incremental-census-v3";
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
  census.entries.forEach((entry, index) => {
    const task = tasks[index];
    if (!task) throw new Error("IIS accepted census has excess evidence");
    validateUrgiisEntry(entry, task, tenant);
    if (entry.kind === "model" && entry.freshness.readAt > census.acceptedAt)
      throw new Error("IIS accepted model evidence is dated in the future");
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

/** Balanced native-control slices start on the first incremental day, even when
 * bootstrap read every page at the same time. Age remains an independent ceiling. */
export function urgiisSweepDue(index: number, now: number, readAt: number) {
  const day = Math.floor(now / URGIIS_DAY_MS);
  return (
    now - readAt >= carryMs ||
    (index % 7 === day % 7 && Math.floor(readAt / URGIIS_DAY_MS) < day)
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
    // Reuse ownership only for an unchanged donor in a carried model. A fresh
    // model read must refresh its own seller evidence, even for an old stock.
    const models = entries
      .filter((e) => e.kind === "model")
      .filter((e) => e.records.some((r) => r.destinations.includes(task.url)));
    if (!models.length || models.some((e) => e.freshness.kind === "read"))
      return undefined;
    const detail = previous.entries.find(
      (e) => e.kind === "detail" && e.url === task.url,
    );
    return detail ? { ...detail, bytes: 0 } : undefined;
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
