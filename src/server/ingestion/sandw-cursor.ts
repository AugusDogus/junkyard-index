import { z } from "zod";
import {
  SandwInventorySchema,
  sandwHash,
  type SandwInventory,
} from "./sandw-parser";
import {
  SANDW_API,
  SANDW_CATALOG,
  SANDW_OWNER,
  SANDW_YARD,
} from "./sandw-yard-metadata";

const scope = sandwHash({
  version: 1,
  yard: SANDW_YARD,
  controls: [SANDW_OWNER, SANDW_CATALOG, SANDW_API],
});
const base = {
  source: z.literal("sandw"),
  version: z.literal(1),
  scope: z.literal(scope),
};
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const schema = z.discriminatedUnion("phase", [
  z.object({ ...base, phase: z.literal("owner") }).strict(),
  z.object({ ...base, phase: z.literal("scope"), ownerHash: hash }).strict(),
  z.object({ ...base, phase: z.literal("catalog"), ownerHash: hash }).strict(),
  z
    .object({
      ...base,
      phase: z.literal("closing"),
      ownerHash: hash,
      opening: SandwInventorySchema,
    })
    .strict(),
  z
    .object({
      ...base,
      phase: z.literal("owner-closing"),
      ownerHash: hash,
      opening: SandwInventorySchema,
      closing: SandwInventorySchema,
    })
    .strict(),
  z.object({ ...base, phase: z.literal("complete") }).strict(),
]);
export type SandwState = z.infer<typeof schema>;
export type SandwCursor = SandwState & { checksum: string };

export const sandwRequiredReport = (report: SandwInventory) => ({
  status: report.status,
  lastSyncedAt: report.lastSyncedAt,
  records: report.vehicles
    .map((row) =>
      JSON.stringify([row.vin, row.year, row.make, row.model, row.vinLast6]),
    )
    .sort(),
});
function checkpoint(state: SandwState): SandwCursor {
  const parsed = schema.parse(state);
  if ("ownerHash" in parsed && parsed.ownerHash !== sandwHash(SANDW_YARD))
    throw new Error("S&W checkpoint owner does not match the verified yard");
  if (
    parsed.phase === "owner-closing" &&
    sandwHash(sandwRequiredReport(parsed.opening)) !==
      sandwHash(sandwRequiredReport(parsed.closing))
  )
    throw new Error(
      "S&W closing report changed its source version, identities or multiplicities",
    );
  return { ...parsed, checksum: sandwHash(parsed) };
}
export const SandwCursor = {
  initial: (): SandwCursor =>
    checkpoint({ source: "sandw", version: 1, scope, phase: "owner" }),
  next(
    state: SandwState,
    phase: "scope" | "catalog",
    ownerHash: string,
  ): SandwCursor {
    return checkpoint({
      source: state.source,
      version: state.version,
      scope: state.scope,
      phase,
      ownerHash,
    });
  },
  checkpoint,
  parse(input: unknown): SandwCursor {
    if (Buffer.byteLength(JSON.stringify(input)) > 4 * 1024 * 1024)
      throw new Error("S&W checkpoint exceeds 4 MiB");
    const wrapper = z.object({ checksum: hash }).passthrough().parse(input);
    const { checksum, ...rest } = wrapper;
    const parsed = checkpoint(schema.parse(rest));
    if (checksum !== parsed.checksum)
      throw new Error(
        "S&W checkpoint checksum changed; retain the last validated checkpoint",
      );
    return parsed;
  },
} as const;
