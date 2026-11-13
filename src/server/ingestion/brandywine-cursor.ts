import { z } from "zod";
import {
  BrandywineControlSchema,
  BRANDYWINE_MAX_DONORS,
  BRANDYWINE_MAX_MAKERS,
  BRANDYWINE_MAX_MODELS,
  type BrandywineBinding,
  type BrandywineControl,
} from "./brandywine-catalog";
import {
  brandywineHash,
  brandywineRoute,
  inspectBrandywineReceipt,
} from "./brandywine-html";
import { BrandywineDetailSchema } from "./brandywine-record";
import { acceptBrandywineDetail } from "./brandywine-parser";
import { brandywineMembership } from "./brandywine-catalog";
import {
  brandywineInventorySnapshot,
  validateBrandywineInventorySnapshot,
} from "./brandywine-transform";
import {
  BRANDYWINE_FRESH,
  BRANDYWINE_INCOMING,
  BRANDYWINE_MANUFACTURERS,
  BRANDYWINE_ROOT,
  BRANDYWINE_YARD,
} from "./brandywine-yard-metadata";

// Observed graph: 46 makers, 414 model routes, 2,027 Brandywine donors.
export const BRANDYWINE_MAX_CONTROLS =
  4 + BRANDYWINE_MAX_MAKERS + BRANDYWINE_MAX_MODELS;
export const BRANDYWINE_MAX_RUN_REQUESTS =
  (2 * BRANDYWINE_MAX_CONTROLS + BRANDYWINE_MAX_DONORS) * 2;
export const BRANDYWINE_MAX_RUN_BYTES = 160 * 1024 * 1024;
export const BRANDYWINE_MAX_CURSOR_BYTES = 16 * 1024 * 1024;
// Maximum 4,160 logical controls *25s, plus 4,160 chunk starts *1.6s,
// leave 17h15m44s for durable pauses inside this finite 48-hour lifetime.
export const BRANDYWINE_MAX_RUN_MS = 48 * 60 * 60 * 1000;
export const BRANDYWINE_CURSOR_SCOPE = brandywineHash({
  version: 1,
  yard: BRANDYWINE_YARD,
  root: BRANDYWINE_ROOT,
  contract:
    "native-maker-lineage/conflict-first-inactive/complete-closing/min1500-v1",
});

/** Reconstruct only literal controls from the complete native menu prefix. */
export function brandywineOpeningPlan(opening: BrandywineControl[]) {
  const urls = [BRANDYWINE_ROOT, BRANDYWINE_MANUFACTURERS];
  const manufacturers = opening[1];
  const models = new Map<string, { make: string; model: string }[]>();
  if (manufacturers?.kind === "manufacturers") {
    urls.push(...manufacturers.entries.map((entry) => entry.url));
    const makerPages = opening.slice(2, 2 + manufacturers.entries.length);
    for (const [index, page] of makerPages.entries()) {
      if (page.kind !== "models")
        throw new Error("Brandywine maker prefix contains a foreign control");
      const maker = manufacturers.entries[index];
      if (!maker)
        throw new Error("Brandywine maker prefix lost its native lineage");
      for (const entry of page.entries)
        models.set(entry.url, [
          ...(models.get(entry.url) ?? []),
          { make: maker.label, model: entry.label },
        ]);
    }
    if (models.size > BRANDYWINE_MAX_MODELS)
      throw new Error(
        "Brandywine model relation graph exceeds its saved-evidence growth cap",
      );
    if (makerPages.length === manufacturers.entries.length)
      urls.push(...models.keys(), BRANDYWINE_INCOMING, BRANDYWINE_FRESH);
  }
  for (const [index, page] of opening.entries()) {
    const route = brandywineRoute(page.url);
    if (
      page.url !== urls[index] ||
      (page.kind === "stock"
        ? route !== (page.scope === "current" ? "stock" : page.scope)
        : page.kind !== route)
    )
      throw new Error(
        "Brandywine checkpoint is not an exact native opening-control prefix",
      );
  }
  return {
    urls,
    models,
    nextUrl: urls[opening.length] ?? null,
    complete:
      opening.length === urls.length &&
      opening.at(-1)?.url === BRANDYWINE_FRESH,
  };
}

export function brandywineDonors(opening: BrandywineControl[]) {
  const plan = brandywineOpeningPlan(opening);
  if (!plan.complete) return [];
  const bindings: BrandywineBinding[] = [];
  for (const control of opening)
    if (control.kind === "stock") {
      for (const row of control.rows) {
        const suffix = /^\d{4}\s+(.+)$/.exec(row.title)?.[1] ?? "";
        const lineage =
          control.scope === "current"
            ? (plan.models.get(control.url) ?? [])
            : [...plan.models.values()]
                .flat()
                .filter((value) => value.model === suffix);
        const makes = [
          ...new Set(
            lineage
              .filter((value) => value.model === suffix)
              .map((value) => value.make),
          ),
        ];
        for (const make of makes.length ? makes : [""])
          bindings.push({ ...row, make, scope: control.scope });
      }
    }
  if (bindings.length > 12000)
    throw new Error(
      "Brandywine total native listing claims exceed the finite 12,000-row cap",
    );
  const targets = new Map<
    string,
    { stock: string; url: string; bindings: BrandywineBinding[] }
  >();
  const byStock = new Map<string, BrandywineBinding[]>();
  for (const binding of bindings)
    byStock.set(binding.stock, [
      ...(byStock.get(binding.stock) ?? []),
      binding,
    ]);
  for (const binding of bindings)
    if (
      binding.yard === "Brandywine" &&
      binding.scope !== "incoming" &&
      !targets.has(binding.stock)
    )
      targets.set(binding.stock, {
        stock: binding.stock,
        url: binding.url,
        bindings: byStock.get(binding.stock) ?? [],
      });
  if (targets.size > BRANDYWINE_MAX_DONORS)
    throw new Error(
      "Brandywine donor union exceeds its finite 3,000-stock cap",
    );
  return [...targets.values()];
}

const common = {
  source: z.literal("brandywine"),
  version: z.literal(1),
  scope: z.literal(BRANDYWINE_CURSOR_SCOPE),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  previousAcceptedCount: z.number().int().nonnegative().nullable(),
  opening: z.array(BrandywineControlSchema).max(BRANDYWINE_MAX_CONTROLS),
  details: z.array(BrandywineDetailSchema).max(BRANDYWINE_MAX_DONORS),
  closing: z.array(BrandywineControlSchema).max(BRANDYWINE_MAX_CONTROLS),
};
const schema = z.discriminatedUnion("phase", [
  z
    .object({ ...common, phase: z.literal("ready"), startedAt: z.null() })
    .strict(),
  z
    .object({
      ...common,
      phase: z.literal("opening"),
      startedAt: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      ...common,
      phase: z.literal("details"),
      startedAt: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      ...common,
      phase: z.literal("closing"),
      startedAt: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      ...common,
      phase: z.literal("complete"),
      startedAt: z.number().int().nonnegative(),
    })
    .strict(),
]);
type State = z.infer<typeof schema>;
const checksum = (state: Omit<State, "checksum">) => {
  const {
    source,
    version,
    scope,
    phase,
    startedAt,
    previousAcceptedCount,
    opening,
    details,
    closing,
  } = state;
  return brandywineHash({
    source,
    version,
    scope,
    phase,
    startedAt,
    previousAcceptedCount,
    opening,
    details,
    closing,
  });
};

/** Complete durable evidence is required before any canonical emission. */
export function inspectBrandywineCursor(state: State) {
  const plan = brandywineOpeningPlan(state.opening),
    donors = brandywineDonors(state.opening);
  if (
    state.phase === "ready"
      ? state.opening.length !== 0 ||
        state.details.length !== 0 ||
        state.closing.length !== 0
      : state.phase === "opening"
        ? plan.complete ||
          state.details.length !== 0 ||
          state.closing.length !== 0
        : !plan.complete ||
          (state.phase === "details"
            ? state.details.length >= donors.length ||
              state.closing.length !== 0
            : state.details.length !== donors.length ||
              (state.phase === "closing"
                ? state.closing.length >= state.opening.length
                : state.closing.length !== state.opening.length))
  )
    throw new Error(
      "Brandywine checkpoint lacks a contiguous complete native control prefix",
    );
  const records = state.details.map((detail, index) => {
    const donor = donors[index];
    if (!donor || detail.url !== donor.url)
      throw new Error(
        "Brandywine donor prefix lost its literal stock destination or ordering",
      );
    return acceptBrandywineDetail(detail, donor.bindings);
  });
  for (const [index, page] of state.closing.entries()) {
    const opening = state.opening[index];
    if (
      !opening ||
      JSON.stringify(brandywineMembership(page)) !==
        JSON.stringify(brandywineMembership(opening))
    )
      throw new Error(
        "Brandywine closing membership, maker lineage, destination or yard binding changed; prior inventory is preserved",
      );
  }
  const observations = [...state.opening, ...state.details, ...state.closing];
  let bytes = 0,
    requests = 0;
  for (const observation of observations) {
    if (observation.receipt.requestUrl !== observation.url)
      throw new Error(
        "Brandywine observation receipt lost its literal request URL",
      );
    inspectBrandywineReceipt(observation.receipt, observation.body);
    for (const wire of observation.receipt.wires) {
      bytes += wire.body.bytes;
      requests++;
    }
  }
  if (
    bytes > BRANDYWINE_MAX_RUN_BYTES ||
    requests > BRANDYWINE_MAX_RUN_REQUESTS
  )
    throw new Error(
      "Brandywine native traversal exceeds its whole-run request or byte cap",
    );
  const snapshot = brandywineInventorySnapshot(records);
  if (state.phase === "closing" || state.phase === "complete")
    validateBrandywineInventorySnapshot(snapshot, state.previousAcceptedCount);
  return { plan, donors, records, ...snapshot, bytes, requests };
}
export const BrandywineCursorSchema = schema.superRefine((state, context) => {
  try {
    if (state.checksum !== checksum(state))
      throw new Error("Brandywine checkpoint checksum changed");
    if (Buffer.byteLength(JSON.stringify(state)) > BRANDYWINE_MAX_CURSOR_BYTES)
      throw new Error("Brandywine checkpoint exceeds 16 MiB");
    inspectBrandywineCursor(state);
  } catch (cause) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
});
export type BrandywineCursor = z.infer<typeof BrandywineCursorSchema>;
function checkpoint(state: Omit<State, "checksum">) {
  return BrandywineCursorSchema.parse({ ...state, checksum: checksum(state) });
}
export const BrandywineCursor = {
  initial: (previousAcceptedCount: number | null) =>
    checkpoint({
      source: "brandywine",
      version: 1,
      scope: BRANDYWINE_CURSOR_SCOPE,
      phase: "ready",
      startedAt: null,
      previousAcceptedCount,
      opening: [],
      details: [],
      closing: [],
    }),
  checkpoint,
  parse: (serialized: string) => {
    if (Buffer.byteLength(serialized) > BRANDYWINE_MAX_CURSOR_BYTES)
      throw new Error("Brandywine serialized checkpoint exceeds 16 MiB");
    const value: unknown = JSON.parse(serialized);
    return BrandywineCursorSchema.parse(value);
  },
  serialize: (state: BrandywineCursor) =>
    JSON.stringify(BrandywineCursorSchema.parse(state)),
} as const;
