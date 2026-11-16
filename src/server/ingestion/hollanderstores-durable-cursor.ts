import { z } from "zod";
import { HollanderstoresCursor } from "./hollanderstores-cursor";
import { HOLLANDERSTORES_MAX_REQUESTS } from "./hollanderstores-limits";

const scope = HollanderstoresCursor.initial().scope;
const common = {
  source: z.literal("hollanderstores"),
  version: z.literal(2),
  scope: z.literal(scope),
};
const referenceSchema = z
  .object({
    ...common,
    phase: z.enum(["opening", "decoding", "closing", "ready", "complete"]),
    requests: z.number().int().min(1).max(HOLLANDERSTORES_MAX_REQUESTS),
    checksum: z.string().regex(/^[a-f0-9]{8}$/),
    // Null exists only between fetching and the repository's atomic checkpoint.
    statePath: z.string().min(1).max(256).nullable(),
  })
  .strict();
const schema = z.union([
  z.object({ ...common, phase: z.literal("initial") }).strict(),
  referenceSchema,
]);

/** Workflow-visible reference. The full checked census lives in a snapshot blob. */
export type HollanderstoresDurableCursor = z.infer<typeof schema>;
export const HollanderstoresDurableCursor = {
  initial(): HollanderstoresDurableCursor {
    return { source: "hollanderstores", version: 2, scope, phase: "initial" };
  },
  parse(value: unknown): HollanderstoresDurableCursor {
    const parsed = schema.safeParse(value);
    if (!parsed.success)
      throw new Error(
        "Hollander Stores durable reference is invalid or predates snapshot storage; restart the ingestion run. Prior published inventory is preserved.",
        { cause: parsed.error },
      );
    return parsed.data;
  },
  fromWire(value: string): HollanderstoresDurableCursor {
    if (Buffer.byteLength(value) > 2048)
      throw new Error(
        "Hollander Stores durable reference exceeds 2 KiB; restart the run. Prior inventory is preserved.",
      );
    return HollanderstoresDurableCursor.parse(JSON.parse(value));
  },
  serialize(value: HollanderstoresDurableCursor): string {
    return JSON.stringify(schema.parse(value));
  },
  checkpoint(state: HollanderstoresCursor): z.infer<typeof referenceSchema> {
    return referenceSchema.parse({
      source: state.source,
      version: 2,
      scope: state.scope,
      phase: state.phase,
      requests: state.requests,
      checksum: state.checksum,
      statePath: null,
    });
  },
  async load(
    value: HollanderstoresDurableCursor,
    loadState: (path: string) => Promise<unknown>,
  ): Promise<HollanderstoresCursor> {
    const cursor = HollanderstoresDurableCursor.parse(value);
    if (cursor.phase === "initial") return HollanderstoresCursor.initial();
    if (!cursor.statePath)
      throw new Error(
        "Hollander Stores checkpoint has no snapshot path; restart the run. Prior inventory is preserved.",
      );
    const state = HollanderstoresCursor.parse(
      await loadState(cursor.statePath),
    );
    if (
      state.checksum !== cursor.checksum ||
      state.phase !== cursor.phase ||
      state.requests !== cursor.requests
    )
      throw new Error(
        "Hollander Stores snapshot does not match its durable reference; inspect the checkpoint and restart the run. Prior inventory is preserved.",
      );
    return state;
  },
} as const;
