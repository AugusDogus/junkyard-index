import { createHash } from "node:crypto";
import { z } from "zod";
import { OEM_ARRIVALS, OEM_MAKES } from "./oem-html";
import {
  OemControlSchema,
  OemPageSchema,
  oemControlUrl,
  type OemControl,
} from "./oem-parser";

export const OEM_MAX_REQUESTS = 1800;
export const OEM_MAX_BODY_BYTES = 4 * 1024 * 1024;
export const OEM_MAX_TOTAL_BYTES = 512 * 1024 * 1024;
export const oemHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const menusSchema = z
  .array(
    z
      .object({
        make: OemControlSchema,
        models: z.array(OemControlSchema).min(1).max(256),
      })
      .strict(),
  )
  .max(128);
const graph = {
  arrivals: OemPageSchema,
  makes: z.array(OemControlSchema).min(1).max(128),
  menus: menusSchema,
};
const census = { ...graph, pages: z.array(OemPageSchema).max(1024) };
const StateSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("arrivals") }).strict(),
  z.object({ phase: z.literal("directory"), arrivals: OemPageSchema }).strict(),
  z.object({ phase: z.literal("menus"), ...graph }).strict(),
  z.object({ phase: z.literal("models"), ...census }).strict(),
  z
    .object({
      phase: z.literal("closing"),
      ...census,
      closing: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ phase: z.literal("complete") }).strict(),
]);
export type OemState = z.infer<typeof StateSchema>;
export type OemCensusState = Extract<OemState, { phase: "closing" }>;
export const oemModels = (menus: z.infer<typeof menusSchema>) =>
  menus.flatMap(({ make, models }) => models.map((model) => ({ make, model })));
export type OemClosingControl =
  | { kind: "arrivals"; url: string }
  | { kind: "makes"; url: string }
  | { kind: "models"; url: string; make: OemControl; index: number }
  | {
      kind: "model";
      url: string;
      make: OemControl;
      model: OemControl;
      index: number;
    };
/** Close all directories and the first/last and every badge-mismatched model.
 * Counts are diagnostics, but an unstable discrepancy must stop reconciliation. */
export function oemClosingControls(state: OemCensusState): OemClosingControl[] {
  const models = oemModels(state.menus);
  const selected = new Set(models.length ? [0, models.length - 1] : []);
  state.pages.forEach((page, index) => {
    if (page.records.length !== models[index]?.model.count) selected.add(index);
  });
  return [
    { kind: "arrivals", url: OEM_ARRIVALS },
    { kind: "makes", url: OEM_MAKES },
    ...state.menus.map(
      ({ make }, index): OemClosingControl => ({
        kind: "models",
        url: oemControlUrl(make, 2),
        make,
        index,
      }),
    ),
    ...[...selected]
      .sort((a, b) => a - b)
      .map((index): OemClosingControl => {
        const entry = models[index];
        if (!entry)
          throw new Error("OEM closing model is outside the native graph");
        return {
          kind: "model",
          url: oemControlUrl(entry.model, 3),
          ...entry,
          index,
        };
      }),
  ];
}
const cursor = z
  .object({
    source: z.literal("oem"),
    version: z.literal(1),
    requests: z.number().int().nonnegative().max(OEM_MAX_REQUESTS),
    bytes: z.number().int().nonnegative().max(OEM_MAX_TOTAL_BYTES),
    state: StateSchema,
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type OemCursor = z.infer<typeof cursor>;
const checksum = (value: Omit<OemCursor, "checksum">) =>
  oemHash({
    source: value.source,
    version: value.version,
    requests: value.requests,
    bytes: value.bytes,
    state: value.state,
  });
function inspect(value: OemCursor): void {
  if (
    Buffer.byteLength(JSON.stringify(value)) > 4 * 1024 * 1024 ||
    value.checksum !== checksum(value)
  )
    throw new Error("OEM checkpoint exceeds 4 MiB or its integrity changed");
  const state = value.state;
  if (state.phase === "complete") return;
  let expected = 0;
  if (state.phase !== "arrivals") {
    expected++;
    if (
      state.arrivals.sourceUrl !== OEM_ARRIVALS ||
      state.arrivals.records.some(
        (r, i) =>
          r.sourceUrl !== OEM_ARRIVALS ||
          r.context.kind !== "arrivals" ||
          r.ordinal !== i,
      )
    )
      throw new Error(
        "OEM arrivals checkpoint lost its source/ordinal binding",
      );
  }
  if (
    state.phase === "menus" ||
    state.phase === "models" ||
    state.phase === "closing"
  ) {
    expected += 1 + state.menus.length;
    if (
      state.menus.length > state.makes.length ||
      (state.phase === "menus" && state.menus.length >= state.makes.length) ||
      (state.phase !== "menus" && state.menus.length !== state.makes.length) ||
      new Set(state.makes.map((m) => oemControlUrl(m, 2))).size !==
        state.makes.length
    )
      throw new Error(
        "OEM make checkpoint is not a contiguous native graph prefix",
      );
    state.menus.forEach((menu, index) => {
      if (oemHash(menu.make) !== oemHash(state.makes[index]))
        throw new Error("OEM model menu lost its native make binding");
      for (const model of menu.models)
        if (
          !oemControlUrl(model, 3).startsWith(
            oemControlUrl(menu.make, 2).replace(/\/$/, "") + "/",
          )
        )
          throw new Error("OEM model checkpoint gained a foreign parent");
    });
    const models = oemModels(state.menus);
    if (
      models.length > 1024 ||
      new Set(models.map((m) => m.model.url)).size !== models.length
    )
      throw new Error("OEM model graph is oversized or repeats a control");
    if (state.phase !== "menus") {
      expected += state.pages.length;
      if (
        state.pages.length > models.length ||
        (state.phase === "models" && state.pages.length >= models.length) ||
        (state.phase === "closing" && state.pages.length !== models.length)
      )
        throw new Error(
          "OEM donor checkpoint is not a contiguous native model prefix",
        );
      state.pages.forEach((page, index) => {
        const entry = models[index];
        if (
          !entry ||
          page.sourceUrl !== oemControlUrl(entry.model, 3) ||
          page.records.some(
            (r, i) =>
              r.ordinal !== i ||
              r.sourceUrl !== page.sourceUrl ||
              r.context.kind !== "model" ||
              oemHash(r.context.make) !== oemHash(entry.make) ||
              oemHash(r.context.model) !== oemHash(entry.model),
          )
        )
          throw new Error(
            "OEM donor checkpoint lost a model/source/ordinal binding",
          );
      });
      if (
        state.arrivals.records.length +
          state.pages.reduce((n, p) => n + p.records.length, 0) >
        20000
      )
        throw new Error("OEM checkpoint exceeds the observed donor capacity");
      if (state.phase === "closing") {
        if (state.closing > oemClosingControls(state).length)
          throw new Error("OEM closing prefix exceeds its native controls");
        expected += state.closing;
      }
    }
  }
  if (
    value.requests !== expected ||
    (expected === 0 ? value.bytes !== 0 : value.bytes < expected)
  )
    throw new Error(
      "OEM checkpoint request/body accounting does not reconcile",
    );
}
export const OemCursorSchema = cursor.superRefine((value, context) => {
  try {
    inspect(value);
  } catch (cause) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        cause instanceof Error ? cause.message : "Invalid OEM checkpoint",
    });
  }
});
function checkpoint(value: Omit<OemCursor, "checksum">): OemCursor {
  // Zod orders nested fields by schema. Hash that parsed representation so
  // serialization/resumption cannot change an otherwise identical checkpoint.
  const parsed = cursor.omit({ checksum: true }).parse({
    source: value.source,
    version: value.version,
    requests: value.requests,
    bytes: value.bytes,
    state: value.state,
  });
  return OemCursorSchema.parse({ ...parsed, checksum: checksum(parsed) });
}
export const OemCursor = {
  schema: OemCursorSchema,
  initial: () =>
    checkpoint({
      source: "oem",
      version: 1,
      requests: 0,
      bytes: 0,
      state: { phase: "arrivals" },
    }),
  checkpoint,
} as const;
