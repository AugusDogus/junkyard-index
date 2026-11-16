import { z } from "zod";
import {
  UrgiisControlSchema,
  UrgiisRecordSchema,
  type UrgiisControl,
} from "./urgiis-schema";
import type { UrgiisTenant } from "./urgiis-tenant";

/** Pure checksum for workflow-safe checkpoint imports. This detects corruption,
 * not hostile signatures. Owned routes and the complete task prefix are validated separately. */
export function urgiisFingerprint(value: unknown): string {
  let hash = 2166136261;
  for (const char of JSON.stringify(value))
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
const receipt = {
  url: z.string().max(2000),
  bytes: z
    .number()
    .int()
    .min(1)
    .max(4 * 1024 * 1024),
};
export const UrgiisEntrySchema = z.discriminatedUnion("kind", [
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
    })
    .strict(),
  z
    .object({
      ...receipt,
      kind: z.enum(["model", "arrivals"]),
      records: z.array(UrgiisRecordSchema).max(499),
    })
    .strict(),
]);
export type UrgiisEntry = z.infer<typeof UrgiisEntrySchema>;
export type UrgiisTask =
  | { kind: "detail"; url: string; stock: string; year: string; vin: string }
  | { kind: "owner"; url: string }
  | { kind: "makes"; url: string }
  | { kind: "arrivals"; url: string }
  | { kind: "menu"; url: string; make: UrgiisControl }
  | { kind: "model"; url: string; make: UrgiisControl; model: UrgiisControl };
export function urgiisTasks(
  entries: readonly UrgiisEntry[],
  tenant: UrgiisTenant,
): UrgiisTask[] {
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
  return [...prefix, ...details.values()];
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
