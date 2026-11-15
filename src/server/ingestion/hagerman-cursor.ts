import { z } from "zod";
import { HagermanCensus, hagermanPageHash } from "./hagerman-catalog";
import { HagermanDonorSchema, HagermanPageSchema } from "./hagerman-parser";
import { HagermanCoordinatesSchema } from "./hagerman-yard-metadata";

export const HAGERMAN_MAX_RUN_MS = 60 * 60 * 1000;
export const HAGERMAN_MAX_RUN_BYTES = 64 * 1024 * 1024;
const base = { source: z.literal("hagerman"), version: z.literal(1) };
const active = {
  ...base,
  startedAt: z.number().int().positive(),
  bytes: z.number().int().positive().max(HAGERMAN_MAX_RUN_BYTES),
  coordinates: HagermanCoordinatesSchema,
  previousAcceptedCount: z.number().int().nonnegative().nullable(),
  profile: z.string().regex(/^[a-f0-9]{64}$/),
};
const details = {
  ...active,
  opening: HagermanPageSchema,
  donors: z.array(HagermanDonorSchema).max(25),
};
const closed = { ...details, closing: z.string().regex(/^[a-f0-9]{64}$/) };
const ready = { ...closed, closingProfile: active.profile };
export const HagermanCursorSchema = z
  .discriminatedUnion("phase", [
    z.object({ ...base, phase: z.literal("start") }).strict(),
    z.object({ ...active, phase: z.literal("opening") }).strict(),
    z.object({ ...details, phase: z.literal("details") }).strict(),
    z.object({ ...details, phase: z.literal("closing") }).strict(),
    z.object({ ...closed, phase: z.literal("identity-closing") }).strict(),
    z.object({ ...ready, phase: z.literal("ready") }).strict(),
    z.object({ ...ready, phase: z.literal("complete") }).strict(),
  ])
  .superRefine((cursor, context) => {
    if (cursor.phase === "start" || cursor.phase === "opening") return;
    const issue = (message: string) =>
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Hagerman checkpoint " + message,
      });
    if (
      cursor.donors.length > cursor.opening.total ||
      cursor.donors.some((donor, index) => {
        const member = cursor.opening.members[index];
        return !member || donor.id !== member.id || donor.url !== member.url;
      })
    )
      return issue("skips, repeats or changes ordered primary assessments");
    if (cursor.phase === "details") {
      if (cursor.donors.length === cursor.opening.total)
        issue("retains an assessment phase after all primary donors");
      return;
    }
    try {
      HagermanCensus.quality(
        cursor.opening,
        cursor.donors,
        cursor.previousAcceptedCount,
      );
    } catch (cause) {
      return issue(cause instanceof Error ? cause.message : String(cause));
    }
    if (
      cursor.phase !== "closing" &&
      cursor.closing !== hagermanPageHash(cursor.opening)
    )
      issue("does not prove unchanged complete closing membership");
    if (
      (cursor.phase === "ready" || cursor.phase === "complete") &&
      cursor.closingProfile !== cursor.profile
    )
      issue("does not prove unchanged closing operator identity");
  });
export type HagermanCursor = z.infer<typeof HagermanCursorSchema>;
export const HagermanCursor = {
  initial: { source: "hagerman", version: 1, phase: "start" },
} as const satisfies { initial: HagermanCursor };
