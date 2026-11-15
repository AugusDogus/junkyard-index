import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ChasencarsCatalogSchema,
  parseChasencarsCatalog,
  parseChasencarsOwner,
  parseChasencarsYard,
} from "./chasencars-parser";
import {
  CHASENCARS_CATALOG,
  CHASENCARS_OWNER,
  CHASENCARS_YARD,
  CHASENCARS_YARD_URL,
  CHASENCARS_MINIMUM_INVENTORY,
} from "./chasencars-yard-metadata";

export const CHASENCARS_MAX_CURSOR_BYTES = 2 * 1024 * 1024;
export const CHASENCARS_MAX_REQUESTS = 6;
export const CHASENCARS_MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const scope = hash([
  CHASENCARS_YARD,
  CHASENCARS_OWNER,
  CHASENCARS_YARD_URL,
  CHASENCARS_CATALOG,
  CHASENCARS_MINIMUM_INVENTORY,
  "complete-dom-report-and-owner-bookends-v1",
]);
const common = {
  source: z.literal("chasencars"),
  version: z.literal(1),
  scope: z.literal(scope),
  previousAcceptedCount: z.number().int().nonnegative().nullable(),
  bytes: z.number().int().nonnegative().max(CHASENCARS_MAX_TOTAL_BYTES),
};
const report = { catalog: ChasencarsCatalogSchema };
const stateSchema = z.discriminatedUnion("phase", [
  z
    .object({ ...common, phase: z.literal("owner"), requests: z.literal(0) })
    .strict(),
  z
    .object({ ...common, phase: z.literal("yard"), requests: z.literal(1) })
    .strict(),
  z
    .object({ ...common, phase: z.literal("catalog"), requests: z.literal(2) })
    .strict(),
  z
    .object({
      ...common,
      ...report,
      phase: z.literal("closing-catalog"),
      requests: z.literal(3),
    })
    .strict(),
  z
    .object({
      ...common,
      ...report,
      phase: z.literal("closing-yard"),
      requests: z.literal(4),
    })
    .strict(),
  z
    .object({
      ...common,
      ...report,
      phase: z.literal("closing-owner"),
      requests: z.literal(5),
    })
    .strict(),
  z
    .object({
      ...common,
      ...report,
      phase: z.literal("ready"),
      requests: z.literal(6),
    })
    .strict(),
  z
    .object({ ...common, phase: z.literal("complete"), requests: z.literal(6) })
    .strict(),
]);
type State = z.infer<typeof stateSchema>;
export type ChasencarsCursor = State & { checksum: string };

const commonState = (cursor: ChasencarsCursor) => ({
  source: cursor.source,
  version: cursor.version,
  scope: cursor.scope,
  previousAcceptedCount: cursor.previousAcceptedCount,
  bytes: cursor.bytes,
  requests: cursor.requests,
});

function checkpoint(
  value: unknown,
  previousAcceptedCount?: number | null,
): ChasencarsCursor {
  const state = stateSchema.parse(value);
  if (
    (previousAcceptedCount !== undefined &&
      state.previousAcceptedCount !== previousAcceptedCount) ||
    (state.requests === 0
      ? state.bytes !== 0
      : state.bytes < state.requests ||
        state.bytes > state.requests * 2 * 1024 * 1024)
  )
    throw new Error(
      "Chase N Cars checkpoint lost its prior-count binding or cumulative request/body accounting",
    );
  const result = { ...state, checksum: hash(state) };
  if (Buffer.byteLength(JSON.stringify(result)) > CHASENCARS_MAX_CURSOR_BYTES)
    throw new Error("Chase N Cars checkpoint exceeds2 MiB");
  return result;
}
function parse(
  value: unknown,
  previousAcceptedCount?: number | null,
): ChasencarsCursor {
  const wire = JSON.stringify(value);
  if (
    wire === undefined ||
    Buffer.byteLength(wire) > CHASENCARS_MAX_CURSOR_BYTES
  )
    throw new Error("Chase N Cars checkpoint is absent or exceeds2 MiB");
  const wrapper = z
    .object({ checksum: z.string().regex(/^[a-f0-9]{64}$/) })
    .passthrough()
    .parse(value);
  const { checksum, ...state } = wrapper;
  const checked = checkpoint(state, previousAcceptedCount);
  if (checksum !== checked.checksum)
    throw new Error(
      "Chase N Cars checkpoint checksum changed; retain the last validated checkpoint",
    );
  return checked;
}
export function chasencarsNextUrl(cursor: ChasencarsCursor): string {
  switch (cursor.phase) {
    case "owner":
    case "closing-owner":
      return CHASENCARS_OWNER;
    case "yard":
    case "closing-yard":
      return CHASENCARS_YARD_URL;
    case "catalog":
    case "closing-catalog":
      return CHASENCARS_CATALOG;
    default:
      throw new Error(
        "Chase N Cars ready/complete checkpoint has no next native request",
      );
  }
}
export function chasencarsAdvance(
  cursor: ChasencarsCursor,
  raw: string,
): ChasencarsCursor {
  const bytes = Buffer.byteLength(raw);
  if (
    bytes === 0 ||
    bytes > 2 * 1024 * 1024 ||
    cursor.requests >= CHASENCARS_MAX_REQUESTS
  )
    throw new Error(
      "Chase N Cars response or whole-run request bound exceeded",
    );
  const state = cursor;
  const next = {
    ...commonState(state),
    bytes: state.bytes + bytes,
    requests: state.requests + 1,
  };
  switch (state.phase) {
    case "owner":
      parseChasencarsOwner(raw);
      return checkpoint({ ...next, phase: "yard" });
    case "yard":
      parseChasencarsYard(raw);
      return checkpoint({ ...next, phase: "catalog" });
    case "catalog":
      return checkpoint({
        ...next,
        phase: "closing-catalog",
        catalog: parseChasencarsCatalog(raw),
      });
    case "closing-catalog":
      if (
        JSON.stringify(parseChasencarsCatalog(raw)) !==
        JSON.stringify(state.catalog)
      )
        throw new Error(
          "Chase N Cars closing report changed native identities, multiplicities, fields or update label",
        );
      return checkpoint({
        ...next,
        catalog: state.catalog,
        phase: "closing-yard",
      });
    case "closing-yard":
      parseChasencarsYard(raw);
      return checkpoint({
        ...next,
        catalog: state.catalog,
        phase: "closing-owner",
      });
    case "closing-owner":
      parseChasencarsOwner(raw);
      return checkpoint({ ...next, catalog: state.catalog, phase: "ready" });
    default:
      throw new Error(
        "Chase N Cars cannot advance a ready/complete checkpoint",
      );
  }
}
export const ChasencarsCursor = {
  initial: (previousAcceptedCount: number | null): ChasencarsCursor =>
    checkpoint({
      source: "chasencars",
      version: 1,
      scope,
      previousAcceptedCount,
      bytes: 0,
      requests: 0,
      phase: "owner",
    }),
  parse,
  fromWire(
    raw: string,
    previousAcceptedCount?: number | null,
  ): ChasencarsCursor {
    if (Buffer.byteLength(raw) > CHASENCARS_MAX_CURSOR_BYTES)
      throw new Error("Chase N Cars serialized checkpoint exceeds2 MiB");
    return parse(JSON.parse(raw), previousAcceptedCount);
  },
  serialize(
    cursor: ChasencarsCursor,
    previousAcceptedCount?: number | null,
  ): string {
    return JSON.stringify(parse(cursor, previousAcceptedCount));
  },
  complete(cursor: ChasencarsCursor): ChasencarsCursor {
    if (cursor.phase !== "ready")
      throw new Error(
        "Chase N Cars completion requires every opening/closing proof",
      );
    return checkpoint({ ...commonState(cursor), phase: "complete" });
  },
} as const;
export const ChasencarsCursorSchema = z
  .unknown()
  .transform((value, context) => {
    try {
      return parse(value);
    } catch (cause) {
      context.addIssue({
        code: "custom",
        message: cause instanceof Error ? cause.message : String(cause),
      });
      return z.NEVER;
    }
  });
