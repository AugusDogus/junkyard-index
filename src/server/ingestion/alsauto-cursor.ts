import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ALSAUTO_API,
  ALSAUTO_CATALOG,
  ALSAUTO_MAX_BODY_BYTES,
  ALSAUTO_MAX_PAGES,
  ALSAUTO_MAX_REQUESTS,
  ALSAUTO_MINIMUM_INVENTORY,
  ALSAUTO_YARD,
} from "./alsauto-configuration";
import { inspectAlsautoEvidence } from "./alsauto-protocol";

export const ALSAUTO_MAX_CURSOR_BYTES = 16 * 1024 * 1024;
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const scope = hash([
  ALSAUTO_API,
  ALSAUTO_CATALOG,
  ALSAUTO_YARD,
  ALSAUTO_MINIMUM_INVENTORY,
  ALSAUTO_MAX_PAGES,
  "complete-ajax-census-and-replay-v1",
]);
const schema = z
  .object({
    source: z.literal("alsauto"),
    version: z.literal(1),
    scope: z.literal(scope),
    phase: z.enum(["collecting", "complete"]),
    previousAcceptedCount: z.number().int().nonnegative().nullable(),
    evidence: z
      .array(z.string().min(1).max(ALSAUTO_MAX_BODY_BYTES))
      .max(ALSAUTO_MAX_REQUESTS),
  })
  .strict();
type State = z.infer<typeof schema>;
export type AlsautoCursor = State & { checksum: string };
function checkpoint(
  input: unknown,
  previousAcceptedCount?: number | null,
): AlsautoCursor {
  const state = schema.parse(input);
  if (
    previousAcceptedCount !== undefined &&
    state.previousAcceptedCount !== previousAcceptedCount
  )
    throw new Error(
      "Al's checkpoint lost its prior complete inventory count binding",
    );
  if (
    state.evidence.some(
      (raw) => Buffer.byteLength(raw) > ALSAUTO_MAX_BODY_BYTES,
    )
  )
    throw new Error("Al's checkpoint contains an oversized native response");
  const result = { ...state, checksum: hash(state) };
  if (Buffer.byteLength(JSON.stringify(result)) > ALSAUTO_MAX_CURSOR_BYTES)
    throw new Error("Al's checkpoint exceeds 16 MiB");
  const progress = inspectAlsautoEvidence(state.evidence);
  if (state.phase === "complete" && progress.kind !== "ready")
    throw new Error(
      "Al's terminal checkpoint omits required opening/closing controls",
    );
  return result;
}
function parse(
  input: unknown,
  previousAcceptedCount?: number | null,
): AlsautoCursor {
  const wire = JSON.stringify(input);
  if (wire === undefined || Buffer.byteLength(wire) > ALSAUTO_MAX_CURSOR_BYTES)
    throw new Error("Al's checkpoint is absent or exceeds 16 MiB");
  const { checksum, ...state } = z
    .object({ checksum: z.string().regex(/^[a-f0-9]{64}$/) })
    .passthrough()
    .parse(input);
  const checked = checkpoint(state, previousAcceptedCount);
  if (checksum !== checked.checksum)
    throw new Error(
      "Al's checkpoint checksum changed; retain the last validated checkpoint",
    );
  return checked;
}
export const AlsautoCursor = {
  initial: (previousAcceptedCount: number | null = null): AlsautoCursor =>
    checkpoint({
      source: "alsauto",
      version: 1,
      scope,
      phase: "collecting",
      previousAcceptedCount,
      evidence: [],
    }),
  parse,
  advance(cursor: AlsautoCursor, raw: string): AlsautoCursor {
    if (
      cursor.phase === "complete" ||
      inspectAlsautoEvidence(cursor.evidence).kind === "ready"
    )
      throw new Error(
        "Al's cannot request another control after the closing owner",
      );
    const { checksum, ...state } = cursor;
    if (checksum !== hash(state))
      throw new Error("Al's checkpoint checksum changed");
    return checkpoint({ ...state, evidence: [...state.evidence, raw] });
  },
  complete(cursor: AlsautoCursor): AlsautoCursor {
    const { checksum, ...state } = cursor;
    if (checksum !== hash(state))
      throw new Error("Al's checkpoint checksum changed");
    return checkpoint({ ...state, phase: "complete" });
  },
  fromWire(raw: string): AlsautoCursor {
    if (Buffer.byteLength(raw) > ALSAUTO_MAX_CURSOR_BYTES)
      throw new Error("Al's serialized checkpoint exceeds 16 MiB");
    return parse(JSON.parse(raw));
  },
  serialize: (cursor: AlsautoCursor): string => JSON.stringify(parse(cursor)),
} as const;
