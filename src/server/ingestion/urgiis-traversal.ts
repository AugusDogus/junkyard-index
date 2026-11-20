import { z } from "zod";
import { urgiisBrokenModelRoute } from "./urgiis-model-coverage";
import {
  UrgiisControlSchema,
  URGIIS_EMPTY_MODEL_MINIMUM,
  UrgiisRecordSchema,
  type UrgiisControl,
} from "./urgiis-schema";
import type { UrgiisTenant } from "./urgiis-tenant";

/** Pure checksum for workflow-safe checkpoint imports. This detects corruption,
 * not hostile signatures. Owned routes and the complete task prefix are validated separately. */
export function urgiisFingerprint(value: unknown): string {
  let hash = 2166136261;
  const encoded = JSON.stringify(value);
  for (let i = 0; i < encoded.length; i++) {
    const code = encoded.charCodeAt(i);
    hash = Math.imul(hash ^ code, 16777619);
    // Preserve the original code-point iteration for surrogate pairs.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < encoded.length) {
      const next = encoded.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
const receipt = {
  url: z.string().max(2000),
  bytes: z
    .number()
    .int()
    .min(0)
    .max(4 * 1024 * 1024),
};
const entrySchema = z.discriminatedUnion("kind", [
  z
    .object({ ...receipt, kind: z.literal("owner"), identity: z.string() })
    .strict(),
  z
    .object({
      ...receipt,
      kind: z.enum(["makes", "menu"]),
      controls: z.array(UrgiisControlSchema).min(1).max(1024),
    })
    .strict(),
  z
    .object({
      ...receipt,
      kind: z.literal("detail"),
      seller: z.string().nullable(),
      // Run start of the read that produced this seller evidence.
      readAt: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      ...receipt,
      kind: z.literal("arrivals"),
      records: z.array(UrgiisRecordSchema).max(499),
    })
    .strict(),
  z
    .object({
      ...receipt,
      kind: z.literal("model"),
      records: z.array(UrgiisRecordSchema).max(499),
      freshness: z
        .object({
          kind: z.enum(["read", "carried", "deferred", "retry"]),
          readAt: z.number().int().nonnegative(),
        })
        .strict(),
    })
    .strict(),
]);
export type UrgiisEntry = z.infer<typeof entrySchema>;

/** Checkpoint-owned evidence is immutable. Reuse only the exact frozen object
 * already parsed here; new wire objects always receive full schema validation. */
export function freezeUrgiisEvidence(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value))
    return;
  for (const item of Object.values(value)) freezeUrgiisEvidence(item);
  Object.freeze(value);
}
const validatedEntries = new WeakMap<object, UrgiisEntry>();
export const UrgiisEntrySchema = z
  .unknown()
  .transform((input, context): UrgiisEntry => {
    const cached =
      input !== null && typeof input === "object"
        ? validatedEntries.get(input)
        : undefined;
    if (cached) return cached;
    const parsed = entrySchema.safeParse(input);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) context.addIssue(issue);
      return z.NEVER;
    }
    freezeUrgiisEvidence(parsed.data);
    validatedEntries.set(parsed.data, parsed.data);
    return parsed.data;
  });
export type UrgiisTask =
  | { kind: "detail"; url: string; stock: string; year: string; vin: string }
  | { kind: "owner"; url: string }
  | { kind: "makes"; url: string }
  | { kind: "arrivals"; url: string }
  | { kind: "menu"; url: string; make: UrgiisControl }
  | { kind: "model"; url: string; make: UrgiisControl; model: UrgiisControl };
const validatedGraphs = new WeakMap<
  UrgiisEntry,
  {
    scope: string;
    prefix: readonly UrgiisEntry[];
    tasks: UrgiisTask[];
  }
>();
export function urgiisTasks(
  entries: readonly UrgiisEntry[],
  tenant: UrgiisTenant,
): UrgiisTask[] {
  const root = entries[0];
  const cached = root ? validatedGraphs.get(root) : undefined;
  const scope =
    tenant.attribution.kind === "seller" ? urgiisFingerprint(tenant) : "";
  if (
    cached &&
    cached.scope === scope &&
    cached.prefix.every((e, i) => entries[i] === e)
  )
    return cached.tasks;
  const fixed: UrgiisTask[] = [
    { kind: "owner", url: tenant.origin + tenant.ownerPath },
    { kind: "makes", url: tenant.origin + tenant.makesPath },
    ...(tenant.arrivalsPath
      ? [
          {
            kind: "arrivals" as const,
            url: tenant.origin + tenant.arrivalsPath,
          },
        ]
      : []),
  ];
  const makes = entries[1];
  if (makes?.kind !== "makes") return fixed;
  const menus: UrgiisTask[] = makes.controls.map((make) => ({
    kind: "menu",
    url: tenant.origin + make.path,
    make,
  }));
  const models: UrgiisTask[] = [];
  for (const [i, make] of makes.controls.entries()) {
    const menu = entries[i + fixed.length];
    if (menu?.kind !== "menu") return [...fixed, ...menus];
    models.push(
      ...menu.controls.map(
        (model): UrgiisTask => ({
          kind: "model",
          url: tenant.origin + model.path,
          make,
          model,
        }),
      ),
    );
  }
  const prefix = [...fixed, ...menus, ...models];
  if (tenant.attribution.kind !== "seller") return prefix;
  const details = new Map<string, UrgiisTask>();
  for (const i of [
    ...(tenant.arrivalsPath ? [2] : []),
    ...models.map((_, i) => fixed.length + menus.length + i),
  ]) {
    const entry = entries[i];
    const task = prefix[i];
    if (
      !entry ||
      !task ||
      !("records" in entry) ||
      (task.kind !== "model" && task.kind !== "arrivals")
    )
      return prefix;
    for (const record of entry.records) {
      const vins = [
        ...new Set(
          record.vins.map((v) => v.trim().toUpperCase()).filter(Boolean),
        ),
      ];
      const vin = vins.length === 1 ? vins[0] : undefined;
      if (!vin) continue;
      const destination = [...new Set(record.destinations)];
      const url =
        destination.length === 1 ? URL.parse(destination[0] ?? "") : null;
      const year = record.years.length === 1 ? record.years[0] : undefined;
      if (
        !url ||
        destination[0]?.includes("\\") ||
        url.pathname.split("/").filter(Boolean).length !== 5 ||
        !url.pathname.startsWith("/" + tenant.pathStyle + "/") ||
        url.origin !== tenant.origin ||
        url.search ||
        url.hash ||
        url.username ||
        url.password ||
        !year ||
        !record.stock ||
        url.pathname !==
          (task.kind === "model"
            ? task.model.path.replace(/\/$/, "")
            : url.pathname.split("/").slice(0, 4).join("/")) +
            "/" +
            record.stock +
            "/" +
            year
      )
        continue;
      details.set(url.href, {
        kind: "detail",
        url: url.href,
        stock: record.stock,
        year,
        vin,
      });
    }
  }
  const tasks = [...prefix, ...details.values()];
  // Seller task discovery scans every model donor. Once that complete prefix
  // is immutable, later detail checkpoints cannot alter the graph it defines.
  const graph = entries.slice(0, prefix.length);
  if (root && graph.every((e) => validatedEntries.has(e))) {
    freezeUrgiisEvidence(tasks);
    validatedGraphs.set(root, { scope, prefix: graph, tasks });
  }
  return tasks;
}
export function urgiisEntryFingerprint(entry: UrgiisEntry) {
  return urgiisFingerprint(
    entry.kind === "owner"
      ? entry.identity
      : "controls" in entry
        ? entry.controls.map(({ path, label }) => ({ path, label }))
        : "records" in entry
          ? entry.records
          : entry.seller,
  );
}
export function validateUrgiisEntry(
  entry: UrgiisEntry,
  task: UrgiisTask,
  tenant: UrgiisTenant,
) {
  if (entry.kind !== task.kind || entry.url !== task.url)
    throw new Error("IIS checkpoint loses its literal contiguous task prefix");
  if (entry.bytes === 0 && entry.kind !== "model" && entry.kind !== "detail")
    throw new Error(
      "IIS current ownership, directories and arrivals require a response receipt",
    );
  if (
    entry.kind === "model" &&
    task.kind === "model" &&
    entry.records.length === 0 &&
    task.model.count >= URGIIS_EMPTY_MODEL_MINIMUM &&
    !urgiisBrokenModelRoute(task.model) &&
    entry.freshness.kind !== "retry" &&
    entry.freshness.kind !== "deferred"
  )
    throw new Error(
      "IIS checkpoint contains an incomplete badged empty model: " + task.url,
    );
  if (entry.kind === "owner") {
    if (entry.identity !== urgiisFingerprint(tenant.ownerClaims))
      throw new Error("IIS checkpoint ownership claims changed");
  } else if ("controls" in entry) {
    const parent =
      task.kind === "menu"
        ? task.make.path.replace(/\/$/, "")
        : "/" + tenant.pathStyle;
    const paths = entry.controls.map((c) => c.path);
    if (
      new Set(paths).size !== paths.length ||
      paths.some((path) => {
        const url = URL.parse(path, tenant.origin);
        const suffix = path.slice(parent.length + 1).replace(/\/$/, "");
        return (
          !url ||
          url.origin !== tenant.origin ||
          url.search ||
          url.hash ||
          url.username ||
          url.password ||
          url.pathname !== path ||
          !path.startsWith(parent + "/") ||
          !suffix ||
          suffix.includes("/")
        );
      })
    )
      throw new Error(
        "IIS checkpoint has an unowned, duplicate or cross-parent directory control",
      );
  }
}
