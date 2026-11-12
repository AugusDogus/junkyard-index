import { Data, Effect } from "effect";
import { z } from "zod";
import {
  vinplusCalendarDate,
  vinplusQuery,
  type VinplusPair,
  type VinplusScope,
} from "./vinplus-protocol";

export type VinplusPublicLocation =
  | Readonly<{ kind: "single-yard" }>
  | Readonly<{ kind: "per-location"; id: string }>;

export type VinplusPublicQuery = Omit<
  ReturnType<typeof vinplusQuery>,
  "location_id"
> &
  Readonly<{ location_id: string | null }>;

export class VinplusPublicError extends Data.TaggedError(
  "VinplusPublicProtocolError",
)<{ operation: "query"; message: string }> {}

const literal = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (value) =>
      value.trim().length > 0 &&
      !/[<>]/.test(value) &&
      ![...value].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) &&
      !/[*%]/.test(value),
  );
const request = z.object({
  yardId: literal.refine((value) => value === value.trim()),
  make: literal,
  model: literal,
  location: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("single-yard") }).strict(),
    z
      .object({
        kind: z.literal("per-location"),
        id: literal.refine((value) => value === value.trim()),
      })
      .strict(),
  ]),
});

/** Caller proves native ownership and exact location configuration separately. */
export function vinplusPublicQuery(
  scope: VinplusScope,
  pair: VinplusPair,
  location: VinplusPublicLocation,
): Effect.Effect<VinplusPublicQuery, VinplusPublicError> {
  return Effect.try({
    try: () => {
      const parsed = request.parse({
        yardId: scope.yardId,
        make: pair.make,
        model: pair.model,
        location,
      });
      return {
        ...vinplusQuery(
          { ...scope, yardId: parsed.yardId },
          { make: parsed.make, model: parsed.model },
        ),
        location_id:
          parsed.location.kind === "per-location" ? parsed.location.id : null,
      };
    },
    catch: () =>
      new VinplusPublicError({
        operation: "query",
        message:
          "VinPlus query requires nonempty literal owner, make/model and an explicit valid location mode. No request was made. Revalidate the native selectors and location configuration before retrying.",
      }),
  });
}

export type VinplusPublicDate =
  | Readonly<{ kind: "calendar"; raw: string; value: string }>
  | Readonly<{
      kind: "offset-timestamp";
      raw: string;
      value: string;
      calendarDate: string;
      offset: string;
    }>;

/** Preserve literal offsets and microseconds. Never infer an instant for a
 * naive timestamp. RFC 3339 -00:00 denotes an unknown offset, not a real one.
 */
export function vinplusPublicDate(raw: unknown): VinplusPublicDate | null {
  if (typeof raw !== "string") return null;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})?)?$/.exec(
      raw,
    );
  if (!match) return null;
  const calendarDate = vinplusCalendarDate(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  );
  if (
    calendarDate === null ||
    (match[4] !== undefined &&
      (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59))
  )
    return null;
  const offset = match[7];
  if (offset === undefined)
    return { kind: "calendar", raw, value: calendarDate };
  if (
    offset === "-00:00" ||
    (offset !== "Z" &&
      (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59))
  )
    return null;
  return {
    kind: "offset-timestamp",
    raw,
    value: raw,
    calendarDate,
    offset,
  };
}
