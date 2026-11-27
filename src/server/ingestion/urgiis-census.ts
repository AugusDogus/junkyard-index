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
import { URGIIS_EMPTY_MODEL_MINIMUM, type UrgiisRecord } from "./urgiis-schema";

export const URGIIS_DAY_MS = 24 * 60 * 60 * 1000;
export const URGIIS_SWEEP_MS = 7 * URGIIS_DAY_MS;
/** How a run uses the accepted census, and so how long it may take. A cold run
 * has no census. A recovery run has a census missing a tenant, or holding one
 * too old to carry anything, so it rereads that tenant in full: it gets the
 * cold deadline, and never more work than a cold census. */
export type UrgiisRunKind = "cold" | "recovery" | "incremental";
export const URGIIS_RUN_DAYS = {
  cold: 3,
  recovery: 3,
  incremental: 1,
} as const satisfies Record<UrgiisRunKind, number>;
/** Carried evidence must be younger than this at run start, reserving the
 * run's deadline before the seven-day ceiling at publication. */
export const urgiisCarryMs = (kind: UrgiisRunKind) =>
  URGIIS_SWEEP_MS - URGIIS_RUN_DAYS[kind] * URGIIS_DAY_MS;
const carryMs = urgiisCarryMs("incremental");
// A freshly read model refreshes its donors' seller details once they are this
// old. That model's next read comes within the carry limit, so no seller
// evidence reaches 21 days plus the carry limit. Other model reads reuse
// unchanged details.
const sellerRefreshMs = 21 * URGIIS_DAY_MS;
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
export function urgiisSweepDue(
  index: number,
  now: number,
  readAt: number,
  carry = carryMs,
) {
  const day = Math.floor(now / URGIIS_DAY_MS);
  const readDay = Math.floor(readAt / URGIIS_DAY_MS);
  if (now - readAt >= carry) return true;
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
type UrgiisModelTask = Extract<UrgiisTask, { kind: "model" }>;
/** Whether an arrivals or model card names this model, by its native donor
 * link or its make/model label. */
function modelDonor(task: UrgiisModelTask) {
  const prefix = task.url.replace(/\/$/, "") + "/";
  return (record: UrgiisRecord) =>
    record.destinations.some((url) => url.startsWith(prefix)) ||
    record.titles.some(
      (title) =>
        title === task.make.label + " " + task.model.label ||
        (title === task.model.label &&
          (task.model.label === task.make.label ||
            task.model.label.startsWith(task.make.label + " "))),
    );
}
export function urgiisCarry(
  task: UrgiisTask,
  entries: readonly UrgiisEntry[],
  previous: UrgiisTenantCensus | undefined,
  now: number,
  carry = carryMs,
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
          ? sellerRefreshMs + carry
          : 0
        : fresh
          ? sellerRefreshMs
          : sellerRefreshMs + carry;
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
  const belongs = modelDonor(task);
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
    urgiisSweepDue(index, now, before.entry.freshness.readAt, carry)
  )
    return undefined;
  return {
    ...before.entry,
    bytes: 0,
    freshness: { ...before.entry.freshness, kind: "carried" },
  };
}
/** Model pages that may fail in a row before the tenant stops, so an outage
 * is not probed page by page. A failure that follows a successful model read
 * defers like the first. Norb's backend times out on its largest models while
 * the rest load. On November 25, 2026, 19 of its 53 models with 50 or more
 * donors failed; its six-day crawl order puts at most five of them in a row.
 * This allows more than twice that. */
export const URGIIS_MODEL_FAILURE_STREAK = 12;
/** Failed model reads since this tenant's last successful one. Frontier model
 * entries are appended in request order; carried entries made no request. */
export function urgiisModelFailureStreak(entries: readonly UrgiisEntry[]) {
  let streak = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    // A revalidated model read its cars' detail pages, so the site answered.
    if (
      entry?.kind !== "model" ||
      entry.freshness.kind === "read" ||
      entry.freshness.kind === "revalidated"
    )
      break;
    if (entry.freshness.kind !== "carried") streak++;
  }
  return streak;
}
/** The native detail page of one prior card: its single owned
 * /pathStyle/MAKE/MODEL/STOCK/YEAR link, naming the card's stock and year. */
function detailPage(
  record: UrgiisRecord,
  task: UrgiisModelTask,
  tenant: UrgiisTenant,
) {
  const destinations = [...new Set(record.destinations)];
  const raw = destinations.length === 1 ? (destinations[0] ?? "") : "";
  const url = URL.parse(raw);
  const year = record.years.length === 1 ? record.years[0] : undefined;
  if (
    !url ||
    !year ||
    !record.stock ||
    raw.includes("\\") ||
    url.origin !== tenant.origin ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    return undefined;
  const [root, style, make, model, stock, last, ...rest] =
    url.pathname.split("/");
  let decoded: string | undefined;
  try {
    decoded = stock === undefined ? undefined : decodeURIComponent(stock);
  } catch {
    return undefined;
  }
  return root === "" &&
    style === tenant.pathStyle &&
    make === task.make.path.split("/")[2] &&
    model &&
    decoded === record.stock &&
    last === year &&
    !rest.length
    ? { url: url.href, stock: record.stock, year }
    : undefined;
}
export interface UrgiisRevalidationCar {
  record: UrgiisRecord;
  url: string;
  stock: string;
  year: string;
}
/**
 * The prior cards of a model whose page failed this run, each with the detail
 * page that shows whether that car is still listed. Norb's backend gives up
 * after about 17 seconds on its largest model pages and renders "No Results
 * Found", while each car's detail page answers in under six seconds and
 * renders "No Results.." once the car is gone (probed November 27, 2026).
 *
 * Needs the same prior model evidence as a deferral, of any age: each kept
 * card is confirmed by its own page this run. New cars still come only from
 * the arrivals page, so an overflowed arrivals window, which requires a full
 * census, rules this out, as do seller-attributed tenants, whose detail pages
 * are separate seller evidence. Cards without a detail link (no stock) cannot
 * be confirmed and are dropped; they are counted in `unconfirmable`.
 */
export function urgiisRevalidationCars(
  task: UrgiisTask,
  entries: readonly UrgiisEntry[],
  previous: UrgiisTenantCensus | undefined,
  tenant: UrgiisTenant,
) {
  const before = previousModel(task, previous);
  if (
    !before ||
    task.kind !== "model" ||
    tenant.attribution.kind === "seller" ||
    task.model.count >= 500 ||
    urgiisArrivalsCoverage(entries, previous).kind === "overflow"
  )
    return undefined;
  const cars = before.entry.records.flatMap((record) => {
    const detail = detailPage(record, task, tenant);
    return detail ? [{ record, ...detail }] : [];
  });
  // With no car to recheck there is no new evidence; defer as before.
  if (!cars.length) return undefined;
  return {
    cars,
    unconfirmable: before.entry.records.length - cars.length,
  };
}
/** Most a revalidated model's still-listed cars plus its new arrivals may
 * differ from its live badge. Fresh Norb's model reads on November 27, 2026
 * differed from their badges by at most four cards. */
const revalidationAllowance = (badge: number) =>
  Math.max(3, Math.ceil(badge * 0.02));
/**
 * The model entry for cars confirmed on their detail pages, at indexes
 * `listed` of `cars`. A page with a failed read can look like a gone car, and
 * a car entered outside the arrivals window is unseen, so the cars still
 * listed plus this model's current arrivals must match its live badge within
 * {@link revalidationAllowance}.
 */
export function urgiisRevalidated(
  task: UrgiisTask,
  cars: readonly UrgiisRevalidationCar[],
  listed: readonly number[],
  entries: readonly UrgiisEntry[],
  previous: UrgiisTenantCensus | undefined,
  now: number,
):
  | { kind: "revalidated"; entry: UrgiisEntry; gone: number }
  | { kind: "incomplete"; reason: string } {
  const before = previousModel(task, previous);
  if (!before || task.kind !== "model")
    return {
      kind: "incomplete",
      reason: "its prior model evidence is no longer available",
    };
  const kept = listed.flatMap((i) => {
    const car = cars[i];
    return car ? [car.record] : [];
  });
  // This model's current arrivals join its evidence, so they are rechecked
  // on their own detail pages after they leave the arrivals window.
  const arrivals = entries.find((e) => e.kind === "arrivals");
  const seen = new Set(kept.map(urgiisDonorIdentity));
  const records = [
    ...kept,
    ...(arrivals?.kind === "arrivals"
      ? arrivals.records.filter(modelDonor(task)).filter((record) => {
          const identity = urgiisDonorIdentity(record);
          if (seen.has(identity)) return false;
          seen.add(identity);
          return true;
        })
      : []),
  ];
  const count = records.length;
  const badge = task.model.count;
  const allowance = revalidationAllowance(badge);
  if (
    Math.abs(count - badge) > allowance ||
    count >= 500 ||
    (kept.length === 0 && badge >= URGIIS_EMPTY_MODEL_MINIMUM)
  )
    return {
      kind: "incomplete",
      reason: `its detail pages and arrivals list ${count} cars, but its live badge advertises ${badge} (allowed difference ${allowance})`,
    };
  return {
    kind: "revalidated",
    entry: {
      ...before.entry,
      bytes: 0,
      records,
      freshness: { kind: "revalidated", readAt: now },
    },
    gone: cars.length - kept.length,
  };
}
export function urgiisDefer(
  task: UrgiisTask,
  entries: readonly UrgiisEntry[],
  previous: UrgiisTenantCensus | undefined,
  now: number,
  carry = carryMs,
) {
  const before = previousModel(task, previous);
  if (
    !before ||
    urgiisArrivalsCoverage(entries, previous).kind === "overflow" ||
    task.kind !== "model" ||
    task.model.count >= 500 ||
    now - before.entry.freshness.readAt >= carry
  )
    return undefined;
  return {
    ...before.entry,
    bytes: 0,
    freshness: { ...before.entry.freshness, kind: "deferred" as const },
  };
}
/** The run kind for `tenants` given the accepted census at run start. */
export function urgiisRunKind(
  census: UrgiisCensus,
  tenants: readonly UrgiisTenant[],
  now: number,
): UrgiisRunKind {
  if (!census.tenants.length) return "cold";
  return tenants.every((tenant) => {
    const entry = census.tenants.find((t) => t.code === tenant.code);
    return entry !== undefined && now - entry.acceptedAt < carryMs;
  })
    ? "incremental"
    : "recovery";
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
