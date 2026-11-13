import { z } from "zod";
import { KodakOwnershipSchema } from "./kodak-parser";

const common = { source: z.literal("kodak"), version: z.literal(1) };
export const KodakCursorSchema = z.discriminatedUnion("phase", [
  z.object({ ...common, phase: z.literal("start") }).strict(),
  z
    .object({
      ...common,
      phase: z.literal("inventory"),
      ownership: KodakOwnershipSchema,
    })
    .strict(),
  z.object({ ...common, phase: z.literal("complete") }).strict(),
]);
export type KodakCursor = z.infer<typeof KodakCursorSchema>;
export const KodakCursor = {
  initial: {
    source: "kodak",
    version: 1,
    phase: "start",
  } as const satisfies KodakCursor,
  parse(raw: string): KodakCursor {
    if (Buffer.byteLength(raw) > 4096)
      throw new Error(
        "Kodak checkpoint exceeds its 4 KiB capacity; retain the previous checkpoint",
      );
    const value: unknown = JSON.parse(raw);
    return KodakCursorSchema.parse(value);
  },
  serialize(cursor: KodakCursor): string {
    return JSON.stringify(KodakCursorSchema.parse(cursor));
  },
} as const;
