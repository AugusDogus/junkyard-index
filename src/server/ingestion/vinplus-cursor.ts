import { z } from "zod";
import { VINPLUS_TENANTS } from "./vinplus-configuration";
import {
  inspectVinplusEvidence,
  vinplusHash,
  VINPLUS_MAX_YARD_REQUESTS,
} from "./vinplus-parser";
import { vinplusSnapshot } from "./vinplus-snapshot";

export const VINPLUS_MAX_CURSOR_BYTES = 16 * 1024 * 1024;
export const VINPLUS_MAX_REQUESTS = 2048;
export const VINPLUS_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const schema = z
  .object({
    source: z.literal("vinplus"),
    version: z.literal(1),
    phase: z.enum(["collecting", "complete"]),
    scope: z.string(),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    yards: z
      .array(
        z.array(z.string().max(4 * 1024 * 1024)).max(VINPLUS_MAX_YARD_REQUESTS),
      )
      .min(1)
      .max(VINPLUS_TENANTS.length),
  })
  .strict();
export type VinplusCursor = z.infer<typeof schema>;
const scope = () => vinplusHash(VINPLUS_TENANTS);
const checksum = (cursor: VinplusCursor) =>
  vinplusHash({ ...cursor, checksum: undefined });
function checkCapacity(cursor: VinplusCursor): void {
  if (Buffer.byteLength(JSON.stringify(cursor)) > VINPLUS_MAX_CURSOR_BYTES)
    throw new Error("VinPlus checkpoint exceeds 16 MiB");
  const bodies = cursor.yards.flat();
  if (
    bodies.length > VINPLUS_MAX_REQUESTS ||
    bodies.reduce((sum, raw) => sum + Buffer.byteLength(raw), 0) >
      VINPLUS_MAX_RESPONSE_BYTES
  )
    throw new Error("VinPlus cumulative request or byte budget exceeded");
}
function validate(input: unknown): VinplusCursor {
  if (Buffer.byteLength(JSON.stringify(input)) > VINPLUS_MAX_CURSOR_BYTES)
    throw new Error("VinPlus checkpoint exceeds 16 MiB");
  const cursor = schema.parse(input);
  if (cursor.scope !== scope() || cursor.checksum !== checksum(cursor))
    throw new Error(
      "VinPlus checkpoint integrity or tenant qualification contract changed",
    );
  checkCapacity(cursor);
  const vins = new Map<string, string>();
  for (const [index, evidence] of cursor.yards.entries()) {
    const tenant = VINPLUS_TENANTS[index];
    if (!tenant)
      throw new Error("VinPlus checkpoint contains an unknown physical yard");
    const progress = inspectVinplusEvidence(tenant, evidence);
    if (index < cursor.yards.length - 1 || cursor.phase === "complete") {
      if (progress.kind !== "complete")
        throw new Error(
          "VinPlus checkpoint skips required controls for an earlier yard",
        );
      // Only VIN ownership is checked here, so photo timing is irrelevant.
      const snapshot = vinplusSnapshot(tenant, progress.records, Date.now());
      for (const vehicle of snapshot.vehicles) {
        const prior = vins.get(vehicle.vin);
        if (prior !== undefined)
          throw new Error(
            `VIN ${vehicle.vin} appears at both ${prior} and ${tenant.yard.code}; inspect the conflicting stocks before retrying`,
          );
        vins.set(vehicle.vin, tenant.yard.code);
      }
    } else if (progress.kind === "complete")
      throw new Error(
        "Completed yard must advance to the next yard or terminal phase",
      );
  }
  if (
    cursor.phase === "complete" &&
    cursor.yards.length !== VINPLUS_TENANTS.length
  )
    throw new Error("VinPlus terminal cursor omits a configured yard");
  return cursor;
}
export const VinplusCursor = {
  checkCapacity,
  initial(): VinplusCursor {
    return this.checkpoint({
      source: "vinplus",
      version: 1,
      phase: "collecting",
      scope: scope(),
      checksum: "0".repeat(64),
      yards: [[]],
    });
  },
  checkpoint(input: VinplusCursor): VinplusCursor {
    const cursor = schema.parse(input);
    return validate({ ...cursor, checksum: checksum(cursor) });
  },
  parse(input: unknown): VinplusCursor {
    return validate(input);
  },
  fromWire(raw: string): VinplusCursor {
    if (Buffer.byteLength(raw) > VINPLUS_MAX_CURSOR_BYTES)
      throw new Error(
        "VinPlus wire checkpoint exceeds 16 MiB before JSON parsing",
      );
    return validate(JSON.parse(raw));
  },
  serialize(cursor: VinplusCursor): string {
    return JSON.stringify(validate(cursor));
  },
} as const;
