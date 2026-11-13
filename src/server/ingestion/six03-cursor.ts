import { z } from "zod";
import {
  Six03CatalogSchema,
  Six03DetailSchema,
  six03Hash,
} from "./six03-parser";
import { six03PendingPosts } from "./six03-snapshot";
import { SIX03_YARD } from "./six03-yard-metadata";

export const SIX03_MAX_CURSOR_BYTES = 1024 * 1024;
export const SIX03_MAX_REQUESTS = 1210;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scope = six03Hash({
  yard: SIX03_YARD,
  authority: "native-unit-data/raw-model/all-owned-destination-conflicts-v1",
});
const progress = z
  .object({
    source: z.literal("six03"),
    version: z.literal(1),
    scope: z.literal(scope),
    checksum: hash,
    phase: z.enum(["contact", "catalog", "details", "closing"]),
    contact: hash.nullable(),
    catalog: Six03CatalogSchema.nullable(),
    details: z.array(Six03DetailSchema).max(1200),
    closing: z.number().int().min(0).max(3),
    requests: z.number().int().min(0).max(SIX03_MAX_REQUESTS),
  })
  .strict();
export type Six03Progress = z.infer<typeof progress>;
const checksum = (state: Omit<Six03Progress, "checksum"> | Six03Progress) =>
  six03Hash([
    state.source,
    state.version,
    state.scope,
    state.phase,
    state.contact,
    state.catalog,
    state.details,
    state.closing,
    state.requests,
  ]);
export const Six03CursorSchema = z
  .discriminatedUnion("phase", [
    progress,
    z
      .object({
        source: z.literal("six03"),
        version: z.literal(1),
        phase: z.literal("complete"),
      })
      .strict(),
  ])
  .superRefine((state, context) => {
    if (state.phase === "complete") return;
    try {
      if (
        Buffer.byteLength(JSON.stringify(state)) > SIX03_MAX_CURSOR_BYTES ||
        state.checksum !== checksum(state)
      )
        throw new Error(
          "603 checkpoint exceeds 1 MiB or its integrity changed",
        );
      const stages = ["contact", "catalog", "details", "closing"];
      const stage = stages.indexOf(state.phase);
      if (
        (stage === 0) !== (state.contact === null) ||
        stage < 2 !== (state.catalog === null)
      )
        throw new Error(
          "603 checkpoint phase lost its native owner/catalog evidence",
        );
      const posts = state.catalog ? six03PendingPosts(state.catalog) : [];
      if (
        (stage < 2 && state.details.length !== 0) ||
        state.details.length > posts.length ||
        (stage === 2 && state.details.length >= posts.length) ||
        (stage === 3 && state.details.length !== posts.length) ||
        state.details.some(
          (row, index) =>
            row.kind !== "article" || row.path !== posts[index]?.[0],
        ) ||
        (stage < 3 && state.closing !== 0)
      )
        throw new Error(
          "603 checkpoint detail/closing evidence is not a contiguous native membership prefix",
        );
      if (
        state.requests !==
        (state.contact === null ? 0 : 1) +
          (state.catalog === null ? 0 : 1) +
          state.details.length +
          state.closing
      )
        throw new Error("603 checkpoint native request accounting changed");
    } catch (cause) {
      context.addIssue({
        code: "custom",
        message:
          cause instanceof Error
            ? cause.message
            : "Invalid 603 native checkpoint",
      });
    }
  });
export type Six03Cursor = z.infer<typeof Six03CursorSchema>;
const initial: Omit<Six03Progress, "checksum"> = {
  source: "six03",
  version: 1,
  scope,
  phase: "contact",
  contact: null,
  catalog: null,
  details: [],
  closing: 0,
  requests: 0,
};
export const Six03Cursor = {
  initial: { ...initial, checksum: checksum(initial) },
  parse(wire: string): Six03Cursor {
    if (Buffer.byteLength(wire) > SIX03_MAX_CURSOR_BYTES)
      throw new Error(
        "603 cursor wire payload exceeds 1 MiB; retain the previous checkpoint",
      );
    const value: unknown = JSON.parse(wire);
    return Six03CursorSchema.parse(value);
  },
  serialize(cursor: Six03Cursor): string {
    return JSON.stringify(Six03CursorSchema.parse(cursor));
  },
  checkpoint(
    state: Omit<Six03Progress, "checksum"> | Six03Progress,
  ): Six03Progress {
    const value = progress.parse({ ...state, checksum: "0".repeat(64) });
    const parsed = Six03CursorSchema.parse({
      ...value,
      checksum: checksum(value),
    });
    if (parsed.phase === "complete")
      throw new Error("Expected a resumable 603 checkpoint");
    return parsed;
  },
} as const;
