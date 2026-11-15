import { z } from "zod";
import {
  northwestHash,
  NorthwestControlSchema,
  NorthwestPageSchema,
  type NorthwestControl,
} from "./northwest-parser";
import { northwestModels, type NorthwestMake } from "./northwest-catalog";
import {
  NORTHWEST_ROOT,
  NORTHWEST_MAKES,
  NORTHWEST_ORIGIN,
  NORTHWEST_YARD,
  northwestBrowsePath,
} from "./northwest-yard-metadata";

export const NORTHWEST_MAX_CURSOR_BYTES = 8 * 1024 * 1024;
export const NORTHWEST_MAX_REQUESTS = 1600;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scope = northwestHash({
  version: 1,
  yard: NORTHWEST_YARD,
  contract:
    "AK01/legacy-model-graph/all-identity-conflicts-quarantined/one-percent-unrecovered-v1",
});
const progress = z
  .object({
    source: z.literal("northwest"),
    version: z.literal(1),
    scope: z.literal(scope),
    checksum: hash,
    phase: z.enum(["root", "directory", "makes", "models", "closing"]),
    root: hash.nullable(),
    makes: z
      .array(
        NorthwestControlSchema.extend({
          models: z.array(NorthwestControlSchema).max(128).nullable(),
        }),
      )
      .max(64),
    pages: z.array(NorthwestPageSchema).max(1024),
    closing: z.number().int().min(0).max(1100),
    requests: z.number().int().min(0).max(NORTHWEST_MAX_REQUESTS),
  })
  .strict();
export type NorthwestProgress = z.infer<typeof progress>;
export type NorthwestClosingControl =
  | { kind: "root"; url: typeof NORTHWEST_ROOT }
  | { kind: "directory"; url: typeof NORTHWEST_MAKES }
  | { kind: "make"; url: string; make: NorthwestMake }
  | {
      kind: "model";
      url: string;
      make: NorthwestMake;
      model: NorthwestControl;
      index: number;
    };

export function northwestClosingControls(
  state: Pick<NorthwestProgress, "makes" | "pages">,
): NorthwestClosingControl[] {
  const models = northwestModels(state.makes);
  const selected = new Set<number>(models.length ? [0, models.length - 1] : []);
  state.pages.forEach((page, index) => {
    if (page.records.length !== models[index]?.model.count) selected.add(index);
  });
  return [
    { kind: "root", url: NORTHWEST_ROOT },
    { kind: "directory", url: NORTHWEST_MAKES },
    ...state.makes.map(
      (make) =>
        ({
          kind: "make",
          url: NORTHWEST_ORIGIN + make.path,
          make,
        }) satisfies NorthwestClosingControl,
    ),
    ...[...selected]
      .sort((a, b) => a - b)
      .map((index) => {
        const entry = models[index];
        if (!entry)
          throw new Error(
            "Northwest closing model is outside the published graph",
          );
        return {
          kind: "model",
          url: NORTHWEST_ORIGIN + entry.model.path,
          ...entry,
          index,
        } satisfies NorthwestClosingControl;
      }),
  ];
}

function checksum(
  state: Omit<NorthwestProgress, "checksum"> | NorthwestProgress,
) {
  return northwestHash({
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

export const NorthwestCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({
        source: z.literal("northwest"),
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
        Buffer.byteLength(JSON.stringify(state)) > NORTHWEST_MAX_CURSOR_BYTES ||
        state.checksum !== checksum(state)
      )
        throw new Error(
          "Northwest checkpoint exceeds 8 MiB or its integrity changed",
        );
      const stage = ["root", "directory", "makes", "models", "closing"].indexOf(
        state.phase,
      );
      const completed = state.makes.filter(
        (make) => make.models !== null,
      ).length;
      const models = northwestModels(state.makes);
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
          "Northwest checkpoint is not a contiguous native root/make prefix",
        );
      if (
        models.length > 1024 ||
        state.pages.length > models.length ||
        (stage < 3 && state.pages.length !== 0) ||
        (stage === 3 && state.pages.length >= models.length) ||
        (stage === 4 && state.pages.length !== models.length) ||
        (stage < 4 && state.closing !== 0) ||
        (stage === 4 && state.closing > northwestClosingControls(state).length)
      )
        throw new Error(
          "Northwest model or closing checkpoint prefix is inconsistent",
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
          "Northwest checkpoint request accounting is inconsistent",
        );
      if (
        new Set(state.makes.map((make) => make.path)).size !==
          state.makes.length ||
        new Set(models.map((entry) => entry.model.path)).size !== models.length
      )
        throw new Error(
          "Northwest checkpoint repeats a published directory destination",
        );
      for (const make of state.makes) {
        if (northwestBrowsePath(NORTHWEST_ORIGIN + make.path, 1) !== make.path)
          throw new Error("Northwest make destination changed");
        for (const model of make.models ?? [])
          if (
            northwestBrowsePath(NORTHWEST_ORIGIN + model.path, 2) !==
              model.path ||
            !model.path.startsWith(make.path.replace(/\/$/, "") + "/")
          )
            throw new Error(
              "Northwest model destination lost its native make binding",
            );
      }
      if (
        state.pages.reduce((count, page) => count + page.records.length, 0) >
        20_000
      )
        throw new Error("Northwest checkpoint exceeds 20000 raw native cards");
      for (const [index, page] of state.pages.entries()) {
        if (page.hash !== northwestHash(page.records))
          throw new Error("Northwest native card fingerprint changed");
        const control = models[index];
        if (
          !control ||
          page.records.some(
            (record) =>
              record.sourceUrl !== NORTHWEST_ORIGIN + control.model.path ||
              record.context.make.path !== control.make.path ||
              record.context.make.label !== control.make.label ||
              record.context.model.path !== control.model.path ||
              record.context.model.label !== control.model.label,
          )
        )
          throw new Error("Northwest checkpoint donor context changed");
      }
    } catch (cause) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          cause instanceof Error
            ? cause.message
            : "Invalid Northwest checkpoint",
      });
    }
  });
export type NorthwestCursor = z.infer<typeof NorthwestCursorSchema>;
const initial: Omit<NorthwestProgress, "checksum"> = {
  source: "northwest",
  version: 1,
  scope,
  phase: "root",
  root: null,
  makes: [],
  pages: [],
  closing: 0,
  requests: 0,
};
export const NorthwestCursor = {
  initial: { ...initial, checksum: checksum(initial) },
  parse(value: string): NorthwestCursor {
    if (Buffer.byteLength(value) > NORTHWEST_MAX_CURSOR_BYTES)
      throw new Error(
        "Northwest cursor exceeds 8 MiB; retain the last validated checkpoint",
      );
    const candidate: unknown = JSON.parse(value);
    return NorthwestCursorSchema.parse(candidate);
  },
  serialize(cursor: NorthwestCursor): string {
    const value = JSON.stringify(NorthwestCursorSchema.parse(cursor));
    if (Buffer.byteLength(value) > NORTHWEST_MAX_CURSOR_BYTES)
      throw new Error(
        "Northwest cursor exceeds 8 MiB; retain the last validated checkpoint",
      );
    return value;
  },
  checkpoint(
    state: Omit<NorthwestProgress, "checksum"> | NorthwestProgress,
  ): NorthwestProgress {
    const canonical = progress.parse({ ...state, checksum: "0".repeat(64) });
    const parsed = NorthwestCursorSchema.parse({
      ...canonical,
      checksum: checksum(canonical),
    });
    if (parsed.phase === "complete")
      throw new Error("Expected a resumable Northwest checkpoint");
    return parsed;
  },
} as const;
