import { z } from "zod";
import {
  scottsHash,
  ScottsControlSchema,
  ScottsPageSchema,
  type ScottsControl,
} from "./scotts-parser";
import { scottsModels, type ScottsMake } from "./scotts-snapshot";
import {
  SCOTTS_ROOT,
  SCOTTS_MAKES,
  SCOTTS_ORIGIN,
  SCOTTS_YARD,
  scottsBrowsePath,
} from "./scotts-yard-metadata";

export const SCOTTS_MAX_CURSOR_BYTES = 2 * 1024 * 1024;
export const SCOTTS_MAX_REQUESTS = 600;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scope = scottsHash({
  version: 1,
  yard: SCOTTS_YARD,
  contract:
    "CC68,XX00/literal-premium-model-graph/required-card-id/all-required-destination-conflicts-quarantined-v1",
});
const progress = z
  .object({
    source: z.literal("scotts"),
    version: z.literal(1),
    scope: z.literal(scope),
    checksum: hash,
    phase: z.enum(["root", "directory", "makes", "models", "closing"]),
    root: hash.nullable(),
    makes: z
      .array(
        ScottsControlSchema.extend({
          models: z.array(ScottsControlSchema).max(128).nullable(),
        }),
      )
      .max(64),
    pages: z.array(ScottsPageSchema).max(1024),
    closing: z.number().int().min(0).max(1100),
    requests: z.number().int().min(0).max(SCOTTS_MAX_REQUESTS),
  })
  .strict();
export type ScottsProgress = z.infer<typeof progress>;
export type ScottsClosingControl =
  | { kind: "root"; url: typeof SCOTTS_ROOT }
  | { kind: "directory"; url: typeof SCOTTS_MAKES }
  | { kind: "make"; url: string; make: ScottsMake }
  | {
      kind: "model";
      url: string;
      make: ScottsMake;
      model: ScottsControl;
      index: number;
    };

export function scottsClosingControls(
  state: Pick<ScottsProgress, "makes" | "pages">,
): ScottsClosingControl[] {
  const models = scottsModels(state.makes);
  const selected = new Set<number>(models.length ? [0, models.length - 1] : []);
  state.pages.forEach((page, index) => {
    if (page.records.length !== models[index]?.model.count) selected.add(index);
  });
  return [
    { kind: "root", url: SCOTTS_ROOT },
    { kind: "directory", url: SCOTTS_MAKES },
    ...state.makes.map(
      (make) =>
        ({
          kind: "make",
          url: SCOTTS_ORIGIN + make.path,
          make,
        }) satisfies ScottsClosingControl,
    ),
    ...[...selected]
      .sort((a, b) => a - b)
      .map((index) => {
        const entry = models[index];
        if (!entry)
          throw new Error(
            "Scotts closing model is outside the published graph",
          );
        return {
          kind: "model",
          url: SCOTTS_ORIGIN + entry.model.path,
          ...entry,
          index,
        } satisfies ScottsClosingControl;
      }),
  ];
}

function checksum(state: Omit<ScottsProgress, "checksum"> | ScottsProgress) {
  return scottsHash({
    source: state.source,
    version: state.version,
    scope: state.scope,
    phase: state.phase,
    root: state.root,
    makes: state.makes,
    pages: state.pages,
    closing: state.closing,
    requests: state.requests,
  });
}

export const ScottsCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({
        source: z.literal("scotts"),
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
        Buffer.byteLength(JSON.stringify(state)) > SCOTTS_MAX_CURSOR_BYTES ||
        state.checksum !== checksum(state)
      )
        throw new Error(
          "Scotts checkpoint exceeds 2 MiB or its integrity changed",
        );
      const stage = ["root", "directory", "makes", "models", "closing"].indexOf(
        state.phase,
      );
      const completed = state.makes.filter(
        (make) => make.models !== null,
      ).length;
      const models = scottsModels(state.makes);
      if (
        (stage === 0) !== (state.root === null) ||
        stage < 2 !== (state.makes.length === 0) ||
        state.makes.slice(0, completed).some((make) => make.models === null) ||
        state.makes.slice(completed).some((make) => make.models !== null) ||
        (stage < 2 && completed !== 0) ||
        (stage === 2 && completed >= state.makes.length) ||
        (stage > 2 && completed !== state.makes.length)
      )
        throw new Error(
          "Scotts checkpoint is not a contiguous native root/make prefix",
        );
      if (
        models.length > 1024 ||
        state.pages.length > models.length ||
        (stage < 3 && state.pages.length !== 0) ||
        (stage === 3 && state.pages.length >= models.length) ||
        (stage === 4 && state.pages.length !== models.length) ||
        (stage < 4 && state.closing !== 0) ||
        (stage === 4 && state.closing > scottsClosingControls(state).length)
      )
        throw new Error(
          "Scotts model or closing checkpoint prefix is inconsistent",
        );
      if (
        state.requests !==
        (state.root === null ? 0 : 1) +
          (state.makes.length ? 1 : 0) +
          completed +
          state.pages.length +
          state.closing
      )
        throw new Error("Scotts checkpoint request accounting is inconsistent");
      if (
        new Set(state.makes.map((make) => make.path)).size !==
          state.makes.length ||
        new Set(models.map((entry) => entry.model.path)).size !== models.length
      )
        throw new Error(
          "Scotts checkpoint repeats a published directory destination",
        );
      for (const make of state.makes) {
        if (scottsBrowsePath(SCOTTS_ORIGIN + make.path, 1) !== make.path)
          throw new Error("Scotts make destination changed");
        for (const model of make.models ?? [])
          if (
            scottsBrowsePath(SCOTTS_ORIGIN + model.path, 2) !== model.path ||
            !model.path.startsWith(make.path.replace(/\/$/, "") + "/")
          )
            throw new Error(
              "Scotts model destination lost its native make binding",
            );
      }
      if (
        state.pages.reduce((count, page) => count + page.records.length, 0) >
        20_000
      )
        throw new Error("Scotts checkpoint exceeds 20000 raw native cards");
      for (const page of state.pages)
        if (page.hash !== scottsHash(page.records))
          throw new Error("Scotts native card fingerprint changed");
    } catch (cause) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          cause instanceof Error ? cause.message : "Invalid Scotts checkpoint",
      });
    }
  });
export type ScottsCursor = z.infer<typeof ScottsCursorSchema>;
const initial: Omit<ScottsProgress, "checksum"> = {
  source: "scotts",
  version: 1,
  scope,
  phase: "root",
  root: null,
  makes: [],
  pages: [],
  closing: 0,
  requests: 0,
};
export const ScottsCursor = {
  initial: { ...initial, checksum: checksum(initial) },
  parse(value: string): ScottsCursor {
    if (Buffer.byteLength(value) > SCOTTS_MAX_CURSOR_BYTES)
      throw new Error(
        "Scotts cursor exceeds 2 MiB; retain the last validated checkpoint",
      );
    const candidate: unknown = JSON.parse(value);
    return ScottsCursorSchema.parse(candidate);
  },
  serialize(cursor: ScottsCursor): string {
    const value = JSON.stringify(ScottsCursorSchema.parse(cursor));
    if (Buffer.byteLength(value) > SCOTTS_MAX_CURSOR_BYTES)
      throw new Error(
        "Scotts cursor exceeds 2 MiB; retain the last validated checkpoint",
      );
    return value;
  },
  checkpoint(
    state: Omit<ScottsProgress, "checksum"> | ScottsProgress,
  ): ScottsProgress {
    const canonical = progress.parse({ ...state, checksum: "0".repeat(64) });
    const parsed = ScottsCursorSchema.parse({
      ...canonical,
      checksum: checksum(canonical),
    });
    if (parsed.phase === "complete")
      throw new Error("Expected a resumable Scotts checkpoint");
    return parsed;
  },
} as const;
