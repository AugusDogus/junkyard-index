import { z } from "zod";
import {
  centralHash,
  CentralControlSchema,
  CentralPageSchema,
  type CentralControl,
} from "./central-parser";
import { centralModels, type CentralMake } from "./central-snapshot";
import {
  CENTRAL_ROOT,
  CENTRAL_MAKES,
  CENTRAL_ORIGIN,
  CENTRAL_YARD,
  centralBrowsePath,
} from "./central-yard-metadata";

export const CENTRAL_MAX_CURSOR_BYTES = 2 * 1024 * 1024;
export const CENTRAL_MAX_REQUESTS = 1600;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scope = centralHash({
  version: 1,
  yard: CENTRAL_YARD,
  contract:
    "DD15/literal-premium-model-graph/all-required-destination-conflicts-quarantined-v1",
});
const progress = z
  .object({
    source: z.literal("central"),
    version: z.literal(1),
    scope: z.literal(scope),
    checksum: hash,
    phase: z.enum(["root", "directory", "makes", "models", "closing"]),
    root: hash.nullable(),
    makes: z
      .array(
        CentralControlSchema.extend({
          models: z.array(CentralControlSchema).max(128).nullable(),
        }),
      )
      .max(64),
    pages: z.array(CentralPageSchema).max(1024),
    closing: z.number().int().min(0).max(1100),
    requests: z.number().int().min(0).max(CENTRAL_MAX_REQUESTS),
  })
  .strict();
export type CentralProgress = z.infer<typeof progress>;
export type CentralClosingControl =
  | { kind: "root"; url: typeof CENTRAL_ROOT }
  | { kind: "directory"; url: typeof CENTRAL_MAKES }
  | { kind: "make"; url: string; make: CentralMake }
  | {
      kind: "model";
      url: string;
      make: CentralMake;
      model: CentralControl;
      index: number;
    };

export function centralClosingControls(
  state: Pick<CentralProgress, "makes" | "pages">,
): CentralClosingControl[] {
  const models = centralModels(state.makes);
  const selected = new Set<number>(models.length ? [0, models.length - 1] : []);
  state.pages.forEach((page, index) => {
    if (page.records.length !== models[index]?.model.count) selected.add(index);
  });
  return [
    { kind: "root", url: CENTRAL_ROOT },
    { kind: "directory", url: CENTRAL_MAKES },
    ...state.makes.map(
      (make) =>
        ({
          kind: "make",
          url: CENTRAL_ORIGIN + make.path,
          make,
        }) satisfies CentralClosingControl,
    ),
    ...[...selected]
      .sort((a, b) => a - b)
      .map((index) => {
        const entry = models[index];
        if (!entry)
          throw new Error(
            "Central closing model is outside the published graph",
          );
        return {
          kind: "model",
          url: CENTRAL_ORIGIN + entry.model.path,
          ...entry,
          index,
        } satisfies CentralClosingControl;
      }),
  ];
}

function checksum(state: Omit<CentralProgress, "checksum"> | CentralProgress) {
  return centralHash({
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

export const CentralCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({
        source: z.literal("central"),
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
        Buffer.byteLength(JSON.stringify(state)) > CENTRAL_MAX_CURSOR_BYTES ||
        state.checksum !== checksum(state)
      )
        throw new Error(
          "Central checkpoint exceeds 2 MiB or its integrity changed",
        );
      const stage = ["root", "directory", "makes", "models", "closing"].indexOf(
        state.phase,
      );
      const completed = state.makes.filter(
        (make) => make.models !== null,
      ).length;
      const models = centralModels(state.makes);
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
          "Central checkpoint is not a contiguous native root/make prefix",
        );
      if (
        models.length > 1024 ||
        state.pages.length > models.length ||
        (stage < 3 && state.pages.length !== 0) ||
        (stage === 3 && state.pages.length >= models.length) ||
        (stage === 4 && state.pages.length !== models.length) ||
        (stage < 4 && state.closing !== 0) ||
        (stage === 4 && state.closing > centralClosingControls(state).length)
      )
        throw new Error(
          "Central model or closing checkpoint prefix is inconsistent",
        );
      if (
        state.requests !==
        (state.root === null ? 0 : 1) +
          (state.makes.length ? 1 : 0) +
          completed +
          state.pages.length +
          state.closing
      )
        throw new Error(
          "Central checkpoint request accounting is inconsistent",
        );
      if (
        new Set(state.makes.map((make) => make.path)).size !==
          state.makes.length ||
        new Set(models.map((entry) => entry.model.path)).size !== models.length
      )
        throw new Error(
          "Central checkpoint repeats a published directory destination",
        );
      for (const make of state.makes) {
        if (centralBrowsePath(CENTRAL_ORIGIN + make.path, 1) !== make.path)
          throw new Error("Central make destination changed");
        for (const model of make.models ?? [])
          if (
            centralBrowsePath(CENTRAL_ORIGIN + model.path, 2) !== model.path ||
            !model.path.startsWith(make.path.replace(/\/$/, "") + "/")
          )
            throw new Error(
              "Central model destination lost its native make binding",
            );
      }
      if (
        state.pages.reduce((count, page) => count + page.records.length, 0) >
        20_000
      )
        throw new Error("Central checkpoint exceeds 20000 raw native cards");
      for (const page of state.pages)
        if (page.hash !== centralHash(page.records))
          throw new Error("Central native card fingerprint changed");
    } catch (cause) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          cause instanceof Error ? cause.message : "Invalid Central checkpoint",
      });
    }
  });
export type CentralCursor = z.infer<typeof CentralCursorSchema>;
const initial: Omit<CentralProgress, "checksum"> = {
  source: "central",
  version: 1,
  scope,
  phase: "root",
  root: null,
  makes: [],
  pages: [],
  closing: 0,
  requests: 0,
};
export const CentralCursor = {
  initial: { ...initial, checksum: checksum(initial) },
  parse(value: string): CentralCursor {
    if (Buffer.byteLength(value) > CENTRAL_MAX_CURSOR_BYTES)
      throw new Error(
        "Central cursor exceeds 2 MiB; retain the last validated checkpoint",
      );
    const candidate: unknown = JSON.parse(value);
    return CentralCursorSchema.parse(candidate);
  },
  serialize(cursor: CentralCursor): string {
    const value = JSON.stringify(CentralCursorSchema.parse(cursor));
    if (Buffer.byteLength(value) > CENTRAL_MAX_CURSOR_BYTES)
      throw new Error(
        "Central cursor exceeds 2 MiB; retain the last validated checkpoint",
      );
    return value;
  },
  checkpoint(
    state: Omit<CentralProgress, "checksum"> | CentralProgress,
  ): CentralProgress {
    const canonical = progress.parse({ ...state, checksum: "0".repeat(64) });
    const parsed = CentralCursorSchema.parse({
      ...canonical,
      checksum: checksum(canonical),
    });
    if (parsed.phase === "complete")
      throw new Error("Expected a resumable Central checkpoint");
    return parsed;
  },
} as const;
