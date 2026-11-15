import { z } from "zod";
import { PICKERS_MAX_CURSOR_BYTES, PickersCursor } from "./pickers-cursor";
import type { PickersSite } from "./pickers-yard-metadata";

/** v1 single-yard checkpoints remain readable during the coverage rollout. */
export type PickersCoverageCursor =
  | PickersCursor
  | {
      source: "pickers";
      version: 2;
      phase: "yard";
      siteCode: PickersSite["code"];
      cursor: PickersCursor;
    }
  | { source: "pickers"; version: 2; phase: "complete" };
const envelope = z.discriminatedUnion("phase", [
  z
    .object({
      source: z.literal("pickers"),
      version: z.literal(2),
      phase: z.literal("yard"),
      siteCode: z.enum([
        "pickers-texarkana",
        "pickers-longview",
        "pickers-reno",
      ]),
      cursor: z.unknown(),
    })
    .strict(),
  z
    .object({
      source: z.literal("pickers"),
      version: z.literal(2),
      phase: z.literal("complete"),
    })
    .strict(),
]);
export const PickersCoverageCursor = {
  initial: {
    source: "pickers",
    version: 2,
    phase: "yard",
    siteCode: "pickers-texarkana",
    cursor: PickersCursor.initial,
  } satisfies PickersCoverageCursor,
  parse(wire: string): PickersCoverageCursor {
    if (Buffer.byteLength(wire) > PICKERS_MAX_CURSOR_BYTES)
      throw new Error(
        "Pickers coverage checkpoint exceeds 1 MiB; prior inventory is preserved",
      );
    const value = z
      .object({
        source: z.literal("pickers").optional(),
        version: z.number().optional(),
      })
      .passthrough()
      .parse(JSON.parse(wire));
    if (value.version !== 2) return PickersCursor.parse(wire);
    const parsed = envelope.parse({ ...value, source: "pickers" });
    if (parsed.phase === "complete") return parsed;
    const cursor = PickersCursor.parse(JSON.stringify(parsed.cursor));
    if (
      cursor.phase !== "start" &&
      (cursor.state.siteCode ?? "pickers-texarkana") !== parsed.siteCode
    )
      throw new Error(
        "Pickers coverage checkpoint belongs to a different physical yard",
      );
    return { ...parsed, cursor };
  },
  serialize(cursor: PickersCoverageCursor): string {
    if (cursor.version === 1) return PickersCursor.serialize(cursor);
    const payload =
      cursor.phase === "yard"
        ? {
            version: cursor.version,
            phase: cursor.phase,
            siteCode: cursor.siteCode,
          }
        : { version: cursor.version, phase: cursor.phase };
    // Reserve the actual envelope bytes before deciding whether to gzip the inner cursor.
    const overhead =
      Buffer.byteLength(JSON.stringify({ ...payload, cursor: null })) - 4;
    const wire = JSON.stringify(
      cursor.phase === "yard"
        ? {
            ...payload,
            cursor: JSON.parse(
              PickersCursor.serialize(
                cursor.cursor,
                PICKERS_MAX_CURSOR_BYTES - overhead,
              ),
            ),
          }
        : payload,
    );
    PickersCoverageCursor.parse(wire);
    return wire;
  },
};
