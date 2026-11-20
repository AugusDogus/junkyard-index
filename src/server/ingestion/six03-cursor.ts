import { z } from "zod";
import {
  Six03CatalogSchema,
  Six03DetailSchema,
  six03Hash,
  six03RestPageCount,
} from "./six03-parser";
import {
  SIX03_MAX_REST_PAGES,
  SIX03_REST_PAGE_SIZE,
  SIX03_YARD,
} from "./six03-yard-metadata";

export const SIX03_MAX_CURSOR_BYTES = 1024 * 1024;
/** Contact, catalog, every REST page of a 1,200-donor roster and the four
 * closing reads. */
export const SIX03_MAX_REQUESTS = 2 + SIX03_MAX_REST_PAGES + 4;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scope = six03Hash({
  yard: SIX03_YARD,
  authority: "native-unit-data/raw-model/all-owned-destination-conflicts-v1",
  transport: "wp-rest-parts-vehicles/id-desc-v1",
});
const progress = z
  .object({
    source: z.literal("six03"),
    version: z.literal(2),
    scope: z.literal(scope),
    checksum: hash,
    phase: z.enum(["contact", "catalog", "donors", "closing"]),
    contact: hash.nullable(),
    catalog: Six03CatalogSchema.nullable(),
    /** Ids of each REST page read, in served order. */
    pages: z
      .array(
        z
          .array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER))
          .min(1)
          .max(SIX03_REST_PAGE_SIZE),
      )
      .max(SIX03_MAX_REST_PAGES),
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
    state.pages,
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
        version: z.literal(2),
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
      const stages = ["contact", "catalog", "donors", "closing"];
      const stage = stages.indexOf(state.phase);
      if (
        (stage === 0) !== (state.contact === null) ||
        stage < 2 !== (state.catalog === null)
      )
        throw new Error(
          "603 checkpoint phase lost its native owner/catalog evidence",
        );
      const roster = new Set(state.catalog?.posts.map((post) => post[0]));
      const pageCount = six03RestPageCount(roster.size);
      const ids = state.pages.flat();
      const fullPages = state.pages.every(
        (page, index) =>
          page.length ===
          (index + 1 < pageCount
            ? SIX03_REST_PAGE_SIZE
            : roster.size - (pageCount - 1) * SIX03_REST_PAGE_SIZE),
      );
      if (
        (stage < 2 && state.pages.length !== 0) ||
        (stage === 2 && state.pages.length >= pageCount) ||
        (stage === 3 && state.pages.length !== pageCount) ||
        !fullPages ||
        ids.length !== state.details.length ||
        ids.some((id, index) => index > 0 && id >= (ids[index - 1] ?? 0)) ||
        new Set(state.details.map((row) => row.path)).size !==
          state.details.length ||
        state.details.some(
          (row) => row.kind !== "article" || !roster.has(row.path),
        ) ||
        (stage < 3 && state.closing !== 0)
      )
        throw new Error(
          "603 checkpoint REST pages are not a contiguous descending-id prefix of the catalog roster",
        );
      if (
        state.requests !==
        (state.contact === null ? 0 : 1) +
          (state.catalog === null ? 0 : 1) +
          state.pages.length +
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
  version: 2,
  scope,
  phase: "contact",
  contact: null,
  catalog: null,
  pages: [],
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
