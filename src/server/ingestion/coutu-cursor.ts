import { z } from "zod";
import {
  coutuHash,
  CoutuControlSchema,
  CoutuPageSchema,
  type CoutuControl,
} from "./coutu-parser";
import { coutuModels, type CoutuMake } from "./coutu-snapshot";
import {
  COUTU_HOME,
  COUTU_ROOT,
  COUTU_ORIGIN,
  coutuBrowsePath,
} from "./coutu-protocol";
import { COUTU_YARD } from "./coutu-yard-metadata";

export const COUTU_MAX_CURSOR_BYTES = 1024 * 1024;
export const COUTU_MAX_REQUESTS = 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scope = coutuHash({
  version: 1,
  yard: COUTU_YARD,
  authority:
    "literal-finite-donor-graph/all-native-claims-and-destination-conflicts-quarantined-v1",
});
const progress = z
  .object({
    source: z.literal("coutu"),
    version: z.literal(1),
    scope: z.literal(scope),
    checksum: hash,
    phase: z.enum(["home", "directory", "makes", "models", "closing"]),
    home: hash.nullable(),
    makes: z
      .array(
        CoutuControlSchema.extend({
          models: z.array(CoutuControlSchema).max(128).nullable(),
        }),
      )
      .max(64),
    pages: z.array(CoutuPageSchema).max(512),
    closing: z.number().int().min(0).max(1024),
    requests: z.number().int().min(0).max(COUTU_MAX_REQUESTS),
  })
  .strict();
export type CoutuProgress = z.infer<typeof progress>;
export type CoutuClosingControl =
  | { kind: "home"; url: typeof COUTU_HOME }
  | { kind: "directory"; url: typeof COUTU_ROOT }
  | { kind: "make"; url: string; make: CoutuMake }
  | {
      kind: "model";
      url: string;
      make: CoutuMake;
      model: CoutuControl;
      index: number;
    };

/** Close the graph and its boundary model lists. This is not an atomic catalog
 * snapshot, and part badges are never interpreted as donor denominators. */
export function coutuClosingControls(
  state: Pick<CoutuProgress, "makes">,
): CoutuClosingControl[] {
  const models = coutuModels(state.makes);
  const selected = new Set(models.length ? [0, models.length - 1] : []);
  return [
    { kind: "home", url: COUTU_HOME },
    { kind: "directory", url: COUTU_ROOT },
    ...state.makes.map(
      (make) =>
        ({
          kind: "make",
          url: COUTU_ORIGIN + make.path,
          make,
        }) satisfies CoutuClosingControl,
    ),
    ...[...selected].map((index) => {
      const item = models[index];
      if (!item)
        throw new Error("Coutu closing model is outside the published graph");
      return {
        kind: "model",
        url: COUTU_ORIGIN + item.model.path,
        ...item,
        index,
      } satisfies CoutuClosingControl;
    }),
  ];
}

function checksum(state: Omit<CoutuProgress, "checksum"> | CoutuProgress) {
  return coutuHash({
    source: state.source,
    version: state.version,
    scope: state.scope,
    phase: state.phase,
    home: state.home,
    makes: state.makes,
    pages: state.pages,
    closing: state.closing,
    requests: state.requests,
  });
}

export const CoutuCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({
        source: z.literal("coutu"),
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
        Buffer.byteLength(JSON.stringify(state)) > COUTU_MAX_CURSOR_BYTES ||
        state.checksum !== checksum(state)
      )
        throw new Error("Coutu cursor size or integrity changed");
      const stage = ["home", "directory", "makes", "models", "closing"].indexOf(
        state.phase,
      );
      const models = coutuModels(state.makes);
      const completedMakes = state.makes.filter(
        (m) => m.models !== null,
      ).length;
      if ((stage === 0) !== (state.home === null))
        throw new Error(
          "Coutu owner/source-role phase evidence is inconsistent",
        );
      if (
        stage < 2 !== (state.makes.length === 0) ||
        (stage < 2 && completedMakes !== 0) ||
        (stage > 2 && completedMakes !== state.makes.length) ||
        state.makes.slice(0, completedMakes).some((m) => m.models === null) ||
        state.makes.slice(completedMakes).some((m) => m.models !== null) ||
        (stage === 2 && completedMakes >= state.makes.length)
      )
        throw new Error(
          "Coutu make evidence is not a contiguous published prefix",
        );
      if (
        models.length > 512 ||
        state.pages.length > models.length ||
        (stage < 3 && state.pages.length !== 0) ||
        (stage === 3 && state.pages.length >= models.length) ||
        (stage === 4 && state.pages.length !== models.length)
      )
        throw new Error("Coutu model page phase/order is inconsistent");
      if (
        (stage < 4 && state.closing !== 0) ||
        (stage === 4 && state.closing > coutuClosingControls(state).length)
      )
        throw new Error("Coutu closing control prefix is inconsistent");
      if (
        state.requests !==
        (state.home === null ? 0 : 1) +
          (state.makes.length ? 1 : 0) +
          completedMakes +
          state.pages.length +
          state.closing
      )
        throw new Error("Coutu request accounting is inconsistent");
      if (
        new Set(state.makes.map((m) => m.path)).size !== state.makes.length ||
        new Set(models.map((m) => m.model.path)).size !== models.length
      )
        throw new Error(
          "Coutu checkpoint repeats a published directory destination",
        );
      for (const make of state.makes) {
        if (coutuBrowsePath(COUTU_ORIGIN + make.path, 1) !== make.path)
          throw new Error("Invalid Coutu make destination");
        for (const model of make.models ?? [])
          if (
            coutuBrowsePath(COUTU_ORIGIN + model.path, 2) !== model.path ||
            !model.path.startsWith(make.path + "/")
          )
            throw new Error("Invalid Coutu model destination binding");
      }
      if (state.pages.reduce((n, p) => n + p.records.length, 0) > 10_000)
        throw new Error("Coutu checkpoint exceeds 10000 raw donor rows");
      for (const [index, page] of state.pages.entries()) {
        const control = models[index];
        if (
          !control ||
          page.hash !== coutuHash(page.records) ||
          page.records.some(
            (r) => r[5] !== control.make.label || r[6] !== control.model.label,
          )
        )
          throw new Error(
            "Coutu native record fingerprint or model binding changed",
          );
      }
    } catch (cause) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          cause instanceof Error
            ? cause.message
            : "Invalid Coutu native checkpoint",
      });
    }
  });
export type CoutuCursor = z.infer<typeof CoutuCursorSchema>;
const initial: Omit<CoutuProgress, "checksum"> = {
  source: "coutu",
  version: 1,
  scope,
  phase: "home",
  home: null,
  makes: [],
  pages: [],
  closing: 0,
  requests: 0,
};
export const CoutuCursor = {
  initial: { ...initial, checksum: checksum(initial) },
  parse(value: string): CoutuCursor {
    if (Buffer.byteLength(value) > COUTU_MAX_CURSOR_BYTES)
      throw new Error(
        "Coutu cursor wire payload exceeds 1 MiB; retain the last validated checkpoint",
      );
    let candidate: unknown;
    try {
      candidate = JSON.parse(value);
    } catch {
      throw new Error(
        "Coutu cursor wire payload is not valid JSON; retain the last validated checkpoint",
      );
    }
    return CoutuCursorSchema.parse(candidate);
  },
  serialize(cursor: CoutuCursor): string {
    const value = JSON.stringify(CoutuCursorSchema.parse(cursor));
    if (Buffer.byteLength(value) > COUTU_MAX_CURSOR_BYTES)
      throw new Error(
        "Coutu cursor wire payload exceeds 1 MiB; retain the last validated checkpoint",
      );
    return value;
  },
  checkpoint(
    state: Omit<CoutuProgress, "checksum"> | CoutuProgress,
  ): CoutuProgress {
    const canonical = progress.parse({ ...state, checksum: "0".repeat(64) });
    const parsed = CoutuCursorSchema.parse({
      ...canonical,
      checksum: checksum(canonical),
    });
    if (parsed.phase === "complete")
      throw new Error("Expected a resumable Coutu checkpoint");
    return parsed;
  },
} as const satisfies {
  initial: CoutuProgress;
  parse: (value: string) => CoutuCursor;
  serialize: (cursor: CoutuCursor) => string;
  checkpoint: (
    state: Omit<CoutuProgress, "checksum"> | CoutuProgress,
  ) => CoutuProgress;
};
