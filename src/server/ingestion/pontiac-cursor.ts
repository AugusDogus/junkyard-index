import { z } from "zod";
import {
  PontiacMappingSchema,
  PontiacPairSchema,
  PontiacQuerySchema,
  PontiacYearSchema,
  pontiacMappingKey,
  pontiacSearchPath,
} from "./pontiac-catalog";
import { PontiacControlSchema, PontiacSearchSchema } from "./pontiac-record";

const source = z.literal("pontiac");
const index = z.number().int().nonnegative().max(10_000);
const controls = z.array(PontiacControlSchema).min(1).max(99);
const pairs = z.array(PontiacPairSchema).min(1).max(10_000);
const donors = z.array(PontiacSearchSchema).min(1).max(10_000);
const unique = (keys: readonly unknown[]) => new Set(keys).size === keys.length;

export const PontiacCursorSchema = z
  .discriminatedUnion("phase", [
    z.object({ source, phase: z.literal("start") }).strict(),
    z.object({ source, phase: z.literal("controls") }).strict(),
    z.object({ source, phase: z.literal("years"), controls }).strict(),
    z
      .object({
        source,
        phase: z.literal("makes"),
        controls,
        years: z.array(PontiacYearSchema).min(1).max(149),
        index,
        pairs: z.array(PontiacPairSchema).max(10_000),
      })
      .strict(),
    z
      .object({
        source,
        phase: z.literal("models"),
        controls,
        pairs,
        index,
        mappings: z.array(PontiacMappingSchema).max(10_000),
      })
      .strict(),
    z
      .object({
        source,
        phase: z.literal("search"),
        controls,
        index,
        queries: z.array(PontiacQuerySchema).min(1).max(10_000),
        donors: z.array(PontiacSearchSchema).max(10_000),
      })
      .strict(),
    z
      .object({
        source,
        phase: z.literal("details"),
        donors,
        index,
        excluded: index,
        rejected: index,
        emitted: index,
        vins: z.array(z.string().min(1).max(17)).max(10_000),
        images: z.array(z.string().url().max(2048)).max(10_000),
      })
      .strict(),
    z.object({ source, phase: z.literal("complete") }).strict(),
  ])
  .superRefine((cursor, context) => {
    let valid = true;
    if ("controls" in cursor)
      valid &&= unique(cursor.controls.map((c) => c.vehicleID));
    if ("pairs" in cursor)
      valid &&= unique(cursor.pairs.map((p) => JSON.stringify(p)));
    if ("donors" in cursor)
      valid &&=
        unique(cursor.donors.map((d) => d.vehicleID)) &&
        unique(cursor.donors.flatMap((d) => (d.stockID ? [d.stockID] : [])));
    switch (cursor.phase) {
      case "makes":
        valid &&=
          cursor.index < cursor.years.length &&
          unique(cursor.years) &&
          cursor.pairs.every((p) =>
            cursor.years.slice(0, cursor.index).includes(p.year),
          );
        break;
      case "models": {
        const preceding = new Set(
          cursor.pairs
            .slice(0, cursor.index)
            .map((p) => JSON.stringify([p.year, p.make])),
        );
        valid &&=
          cursor.index < cursor.pairs.length &&
          unique(cursor.mappings.map(pontiacMappingKey)) &&
          cursor.mappings.every((m) =>
            preceding.has(JSON.stringify([m.year, m.make])),
          );
        break;
      }
      case "search":
        valid &&=
          cursor.index < cursor.queries.length &&
          unique(cursor.queries.map(pontiacSearchPath)) &&
          (cursor.index > 0 || cursor.donors.length === 0);
        break;
      case "details":
        valid &&=
          cursor.index < cursor.donors.length &&
          cursor.excluded + cursor.rejected + cursor.emitted === cursor.index &&
          cursor.vins.length >= cursor.emitted &&
          cursor.vins.length <= cursor.index - cursor.excluded &&
          unique(cursor.vins) &&
          cursor.images.length <= cursor.emitted &&
          unique(cursor.images);
        break;
    }
    if (!valid)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Pontiac checkpoint indices, identities and quality counters must match completed requests; restart from the last validated checkpoint",
      });
  });

export type PontiacCursor = z.infer<typeof PontiacCursorSchema>;
export const PontiacCursor = {
  initial: { source: "pontiac", phase: "start" },
} as const satisfies { initial: PontiacCursor };
