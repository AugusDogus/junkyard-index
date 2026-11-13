import { z } from "zod";
import {
  aplusHash,
  AplusControlSchema,
  AplusPageSchema,
  type AplusControl,
} from "./aplus-parser";
import { aplusModels, type AplusMake } from "./aplus-snapshot";
import {
  APLUS_CONTACT,
  APLUS_MAKES,
  APLUS_ORIGIN,
  APLUS_ROOT,
  APLUS_YARD,
  aplusBrowsePath,
} from "./aplus-yard-metadata";

export const APLUS_MAX_CURSOR_BYTES = 1024 * 1024;
export const APLUS_MAX_REQUESTS = 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scope = aplusHash({
  version: 1,
  yard: APLUS_YARD,
  authority:
    "literal-model-graph/native-arrival-union/all-conflicts-quarantined-v1",
});
const MakeSchema = AplusControlSchema.extend({
  models: z.array(AplusControlSchema).max(128).nullable(),
});
const progress = z
  .object({
    source: z.literal("aplus"),
    version: z.literal(1),
    scope: z.literal(scope),
    checksum: hash,
    phase: z.enum([
      "contact",
      "root",
      "directory",
      "makes",
      "models",
      "closing",
    ]),
    contact: hash.nullable(),
    makes: z.array(MakeSchema).max(64),
    pages: z.array(AplusPageSchema).max(512),
    arrivals: z.array(AplusPageSchema).max(2),
    closing: z.number().int().min(0).max(1024),
    requests: z.number().int().min(0).max(APLUS_MAX_REQUESTS),
  })
  .strict();
export type AplusProgress = z.infer<typeof progress>;
export type AplusClosingControl =
  | { kind: "contact"; url: typeof APLUS_CONTACT }
  | { kind: "directory"; url: typeof APLUS_MAKES }
  | { kind: "make"; url: string; make: AplusMake }
  | {
      kind: "model";
      url: string;
      make: AplusMake;
      model: AplusControl;
      index: number;
    }
  | { kind: "root"; url: typeof APLUS_ROOT };

export function aplusClosingControls(
  state: Pick<AplusProgress, "makes" | "pages" | "arrivals">,
): AplusClosingControl[] {
  const models = aplusModels(state.makes);
  const selected = new Set<number>(models.length ? [0, models.length - 1] : []);
  state.pages.forEach((page, index) => {
    if (page.records.length !== models[index]?.model.count) selected.add(index);
  });
  // Close every literal model containing an arrival absent from its own list.
  // A native arrival-only model with no published control remains in the union;
  // its detail URL is not repurposed into an invented browse route.
  for (const record of state.arrivals[0]?.records ?? []) {
    const path = record[4].startsWith(APLUS_ORIGIN)
      ? record[4].slice(APLUS_ORIGIN.length)
      : record[4];
    const parent = path.split("/").slice(0, -2).join("/");
    const index = models.findIndex(
      (m) => m.model.path.replace(/\/$/, "") === parent,
    );
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
        throw new Error("Aplus closing model is outside the published graph");
      return {
        kind: "model",
        url: APLUS_ORIGIN + value.model.path,
        make: value.make,
        model: value.model,
        index,
      } satisfies AplusClosingControl;
    });
  return [
    { kind: "contact", url: APLUS_CONTACT },
    { kind: "directory", url: APLUS_MAKES },
    ...state.makes.map(
      (make) =>
        ({
          kind: "make",
          url: APLUS_ORIGIN + make.path,
          make,
        }) satisfies AplusClosingControl,
    ),
    ...modelControls,
    { kind: "root", url: APLUS_ROOT },
  ];
}

function checksum(state: Omit<AplusProgress, "checksum"> | AplusProgress) {
  return aplusHash({
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

export const AplusCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({
        source: z.literal("aplus"),
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
        Buffer.byteLength(JSON.stringify(state)) > APLUS_MAX_CURSOR_BYTES ||
        state.checksum !== checksum(state)
      )
        throw new Error("Aplus cursor size or integrity changed");
      const stages = [
        "contact",
        "root",
        "directory",
        "makes",
        "models",
        "closing",
      ];
      const stage = stages.indexOf(state.phase);
      const models = aplusModels(state.makes);
      const completedMakes = state.makes.filter(
        (m) => m.models !== null,
      ).length;
      if (
        (stage === 0) !== (state.contact === null) ||
        (stage < 2
          ? state.arrivals.length !== 0
          : state.arrivals.length !==
            (state.phase === "closing" &&
            state.closing === aplusClosingControls(state).length
              ? 2
              : 1))
      )
        throw new Error("Aplus owner/root phase evidence is inconsistent");
      if (
        stage < 3 !== (state.makes.length === 0) ||
        completedMakes !==
          (stage < 3 ? 0 : stage === 3 ? completedMakes : state.makes.length) ||
        state.makes.slice(0, completedMakes).some((m) => m.models === null) ||
        state.makes.slice(completedMakes).some((m) => m.models !== null)
      )
        throw new Error(
          "Aplus make directory evidence is not a contiguous published prefix",
        );
      if (
        models.length > 512 ||
        state.pages.length > models.length ||
        (stage < 4 && state.pages.length !== 0) ||
        (stage === 4 && state.pages.length >= models.length) ||
        (stage === 5 && state.pages.length !== models.length) ||
        (stage === 3 && completedMakes >= state.makes.length)
      )
        throw new Error("Aplus model page phase/order is inconsistent");
      if (
        (stage < 5 && state.closing !== 0) ||
        (stage === 5 && state.closing > aplusClosingControls(state).length)
      )
        throw new Error("Aplus closing control prefix is inconsistent");
      if (
        state.requests !==
        (state.contact === null ? 0 : 1) +
          state.arrivals.length +
          (state.makes.length ? 1 : 0) +
          completedMakes +
          state.pages.length +
          state.closing -
          (state.arrivals.length === 2 ? 1 : 0)
      )
        throw new Error("Aplus request accounting is inconsistent");
      if (
        new Set(state.makes.map((m) => m.path)).size !== state.makes.length ||
        new Set(models.map((m) => m.model.path)).size !== models.length
      )
        throw new Error(
          "Aplus checkpoint repeats a native directory destination",
        );
      for (const make of state.makes) {
        if (aplusBrowsePath(APLUS_ORIGIN + make.path, 1) !== make.path)
          throw new Error("Invalid Aplus make destination");
        for (const model of make.models ?? [])
          if (
            aplusBrowsePath(APLUS_ORIGIN + model.path, 2) !== model.path ||
            !model.path.startsWith(make.path.replace(/\/$/, "") + "/")
          )
            throw new Error("Invalid Aplus model destination binding");
      }
      if (state.pages.reduce((n, p) => n + p.records.length, 0) > 10_000)
        throw new Error("Aplus checkpoint exceeds 10000 raw model rows");
      for (const page of [...state.pages, ...state.arrivals])
        if (page.hash !== aplusHash(page.records))
          throw new Error("Aplus native record fingerprint changed");
    } catch (cause) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          cause instanceof Error
            ? cause.message
            : "Invalid Aplus native checkpoint",
      });
    }
  });
export type AplusCursor = z.infer<typeof AplusCursorSchema>;
const initial: Omit<AplusProgress, "checksum"> = {
  source: "aplus",
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
export const AplusCursor = {
  initial: { ...initial, checksum: checksum(initial) },
  parse(value: string): AplusCursor {
    if (Buffer.byteLength(value) > APLUS_MAX_CURSOR_BYTES)
      throw new Error(
        "Aplus cursor wire payload exceeds 1 MiB; keep the last validated checkpoint",
      );
    let candidate: unknown;
    try {
      candidate = JSON.parse(value);
    } catch {
      throw new Error(
        "Aplus cursor wire payload is not valid JSON; keep the last validated checkpoint",
      );
    }
    return AplusCursorSchema.parse(candidate);
  },
  serialize(cursor: AplusCursor): string {
    const value = JSON.stringify(AplusCursorSchema.parse(cursor));
    if (Buffer.byteLength(value) > APLUS_MAX_CURSOR_BYTES)
      throw new Error(
        "Aplus cursor wire payload exceeds 1 MiB; keep the last validated checkpoint",
      );
    return value;
  },
  checkpoint(
    state: Omit<AplusProgress, "checksum"> | AplusProgress,
  ): AplusProgress {
    const canonical = progress.parse({ ...state, checksum: "0".repeat(64) });
    const parsed = AplusCursorSchema.parse({
      ...canonical,
      checksum: checksum(canonical),
    });
    if (parsed.phase === "complete")
      throw new Error("Expected a resumable Aplus checkpoint");
    return parsed;
  },
} as const satisfies {
  initial: AplusProgress;
  parse: (value: string) => AplusCursor;
  serialize: (cursor: AplusCursor) => string;
  checkpoint: (
    state: Omit<AplusProgress, "checksum"> | AplusProgress,
  ) => AplusProgress;
};
