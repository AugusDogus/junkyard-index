import { z } from "zod";
import {
  aviationHash,
  AviationControlSchema,
  AviationPageSchema,
  type AviationControl,
} from "./aviation-parser";
import { aviationModels, type AviationMake } from "./aviation-snapshot";
import {
  AVIATION_CONTACT,
  AVIATION_MAKES,
  AVIATION_ORIGIN,
  AVIATION_PARTS,
  AVIATION_ROOT,
  AVIATION_YARD,
  aviationBrowsePath,
} from "./aviation-yard-metadata";

export const AVIATION_MAX_CURSOR_BYTES = 1024 * 1024;
export const AVIATION_MAX_REQUESTS = 650;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scope = aviationHash({
  version: 1,
  yard: AVIATION_YARD,
  authority:
    "literal-model-graph/native-arrival-union/all-conflicts-quarantined-v1",
});
const MakeSchema = AviationControlSchema.extend({
  models: z.array(AviationControlSchema).max(128).nullable(),
});
const progress = z
  .object({
    source: z.literal("aviation"),
    version: z.literal(1),
    scope: z.literal(scope),
    checksum: hash,
    phase: z.enum([
      "contact",
      "root",
      "directory",
      "configured",
      "makes",
      "models",
      "closing",
    ]),
    contact: hash.nullable(),
    makes: z.array(MakeSchema).max(64),
    pages: z.array(AviationPageSchema).max(512),
    arrivals: z.array(AviationPageSchema).max(2),
    closing: z.number().int().min(0).max(200),
    requests: z.number().int().min(0).max(AVIATION_MAX_REQUESTS),
  })
  .strict();
export type AviationProgress = z.infer<typeof progress>;
export type AviationClosingControl =
  | { kind: "contact"; url: typeof AVIATION_CONTACT }
  | { kind: "directory"; url: typeof AVIATION_PARTS | typeof AVIATION_MAKES }
  | { kind: "make"; url: string; make: AviationMake }
  | {
      kind: "model";
      url: string;
      make: AviationMake;
      model: AviationControl;
      index: number;
    }
  | { kind: "root"; url: typeof AVIATION_ROOT };

export function aviationClosingControls(
  state: Pick<AviationProgress, "makes" | "pages" | "arrivals">,
): AviationClosingControl[] {
  const models = aviationModels(state.makes);
  const selected = new Set<number>(models.length ? [0, models.length - 1] : []);
  state.pages.forEach((page, index) => {
    if (page.records.length !== models[index]?.model.count) selected.add(index);
  });
  // Close every literal model containing an arrival absent from its own list.
  // A native arrival-only model with no published control remains in the union;
  // its detail URL is not repurposed into an invented browse route.
  for (const record of state.arrivals[0]?.records ?? []) {
    const path = record[4].startsWith(AVIATION_ORIGIN)
      ? record[4].slice(AVIATION_ORIGIN.length)
      : record[4];
    const parent = path.split("/").slice(0, -2).join("/");
    const index = models.findIndex((m) => m.model.path === parent);
    if (
      index >= 0 &&
      !state.pages[index]?.records.some((r) => r[0] === record[0])
    )
      selected.add(index);
  }
  const modelControls = [...selected]
    .sort((a, b) => a - b)
    .map((index) => {
      const value = models[index];
      if (!value)
        throw new Error(
          "Aviation closing model is outside the published graph",
        );
      return {
        kind: "model",
        url: AVIATION_ORIGIN + value.model.path,
        make: value.make,
        model: value.model,
        index,
      } satisfies AviationClosingControl;
    });
  return [
    { kind: "contact", url: AVIATION_CONTACT },
    { kind: "directory", url: AVIATION_PARTS },
    { kind: "directory", url: AVIATION_MAKES },
    ...state.makes.map(
      (make) =>
        ({
          kind: "make",
          url: AVIATION_ORIGIN + make.path,
          make,
        }) satisfies AviationClosingControl,
    ),
    ...modelControls,
    { kind: "root", url: AVIATION_ROOT },
  ];
}

function checksum(
  state: Omit<AviationProgress, "checksum"> | AviationProgress,
) {
  return aviationHash({
    source: state.source,
    version: state.version,
    scope: state.scope,
    phase: state.phase,
    contact: state.contact,
    makes: state.makes,
    pages: state.pages,
    arrivals: state.arrivals,
    closing: state.closing,
    requests: state.requests,
  });
}

export const AviationCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({
        source: z.literal("aviation"),
        version: z.literal(1),
        phase: z.literal("complete"),
      })
      .strict(),
    progress,
  ])
  .superRefine((state, context) => {
    if (state.phase === "complete") return;
    try {
      if (
        Buffer.byteLength(JSON.stringify(state)) > AVIATION_MAX_CURSOR_BYTES ||
        state.checksum !== checksum(state)
      )
        throw new Error("Aviation cursor size or integrity changed");
      const stages = [
        "contact",
        "root",
        "directory",
        "configured",
        "makes",
        "models",
        "closing",
      ];
      const stage = stages.indexOf(state.phase);
      const models = aviationModels(state.makes);
      const completedMakes = state.makes.filter(
        (m) => m.models !== null,
      ).length;
      if (
        (stage === 0) !== (state.contact === null) ||
        (stage < 2
          ? state.arrivals.length !== 0
          : state.arrivals.length !==
            (state.phase === "closing" &&
            state.closing === aviationClosingControls(state).length
              ? 2
              : 1))
      )
        throw new Error("Aviation owner/root phase evidence is inconsistent");
      if (
        stage < 3 !== (state.makes.length === 0) ||
        completedMakes !==
          (stage < 4 ? 0 : stage === 4 ? completedMakes : state.makes.length) ||
        state.makes.slice(0, completedMakes).some((m) => m.models === null) ||
        state.makes.slice(completedMakes).some((m) => m.models !== null)
      )
        throw new Error(
          "Aviation make directory evidence is not a contiguous published prefix",
        );
      if (
        models.length > 512 ||
        state.pages.length > models.length ||
        (stage < 5 && state.pages.length !== 0) ||
        (stage === 5 && state.pages.length >= models.length) ||
        (stage === 6 && state.pages.length !== models.length) ||
        (stage === 4 && completedMakes >= state.makes.length)
      )
        throw new Error("Aviation model page phase/order is inconsistent");
      if (
        (stage < 6 && state.closing !== 0) ||
        (stage === 6 && state.closing > aviationClosingControls(state).length)
      )
        throw new Error("Aviation closing control prefix is inconsistent");
      if (
        state.requests !==
        (state.contact === null ? 0 : 1) +
          state.arrivals.length +
          (state.makes.length ? 1 : 0) +
          (stage >= 4 ? 1 : 0) +
          completedMakes +
          state.pages.length +
          state.closing -
          (state.arrivals.length === 2 ? 1 : 0)
      )
        throw new Error("Aviation request accounting is inconsistent");
      if (
        new Set(state.makes.map((m) => m.path)).size !== state.makes.length ||
        new Set(models.map((m) => m.model.path)).size !== models.length
      )
        throw new Error(
          "Aviation checkpoint repeats a native directory destination",
        );
      for (const make of state.makes) {
        if (aviationBrowsePath(AVIATION_ORIGIN + make.path, 1) !== make.path)
          throw new Error("Invalid Aviation make destination");
        for (const model of make.models ?? [])
          if (
            aviationBrowsePath(AVIATION_ORIGIN + model.path, 2) !==
              model.path ||
            !model.path.startsWith(make.path + "/")
          )
            throw new Error("Invalid Aviation model destination binding");
      }
      if (state.pages.reduce((n, p) => n + p.records.length, 0) > 10_000)
        throw new Error("Aviation checkpoint exceeds 10000 raw model rows");
      for (const page of [...state.pages, ...state.arrivals])
        if (page.hash !== aviationHash(page.records))
          throw new Error("Aviation native record fingerprint changed");
    } catch (cause) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          cause instanceof Error
            ? cause.message
            : "Invalid Aviation native checkpoint",
      });
    }
  });
export type AviationCursor = z.infer<typeof AviationCursorSchema>;
const initial: Omit<AviationProgress, "checksum"> = {
  source: "aviation",
  version: 1,
  scope,
  phase: "contact",
  contact: null,
  makes: [],
  pages: [],
  arrivals: [],
  closing: 0,
  requests: 0,
};
export const AviationCursor = {
  initial: { ...initial, checksum: checksum(initial) },
  parse(value: string): AviationCursor {
    if (Buffer.byteLength(value) > AVIATION_MAX_CURSOR_BYTES)
      throw new Error(
        "Aviation cursor wire payload exceeds 1 MiB; keep the last validated checkpoint",
      );
    let candidate: unknown;
    try {
      candidate = JSON.parse(value);
    } catch {
      throw new Error(
        "Aviation cursor wire payload is not valid JSON; keep the last validated checkpoint",
      );
    }
    return AviationCursorSchema.parse(candidate);
  },
  serialize(cursor: AviationCursor): string {
    const value = JSON.stringify(AviationCursorSchema.parse(cursor));
    if (Buffer.byteLength(value) > AVIATION_MAX_CURSOR_BYTES)
      throw new Error(
        "Aviation cursor wire payload exceeds 1 MiB; keep the last validated checkpoint",
      );
    return value;
  },
  checkpoint(
    state: Omit<AviationProgress, "checksum"> | AviationProgress,
  ): AviationProgress {
    const canonical = progress.parse({ ...state, checksum: "0".repeat(64) });
    const parsed = AviationCursorSchema.parse({
      ...canonical,
      checksum: checksum(canonical),
    });
    if (parsed.phase === "complete")
      throw new Error("Expected a resumable Aviation checkpoint");
    return parsed;
  },
} as const satisfies {
  initial: AviationProgress;
  parse: (value: string) => AviationCursor;
  serialize: (cursor: AviationCursor) => string;
  checkpoint: (
    state: Omit<AviationProgress, "checksum"> | AviationProgress,
  ) => AviationProgress;
};
