import { z } from "zod";
import {
  IndianriverPageSchema,
  indianriverHash,
  type IndianriverPage,
} from "./indianriver-parser";
import {
  INDIANRIVER_CATALOG,
  INDIANRIVER_MAX_PAGES,
  INDIANRIVER_PAGE_SIZE,
  INDIANRIVER_YARD,
} from "./indianriver-yard-metadata";

const scope = indianriverHash({
  version: 1,
  yard: INDIANRIVER_YARD,
  catalog: INDIANRIVER_CATALOG,
});
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const base = {
  source: z.literal("indianriver"),
  version: z.literal(1),
  scope: z.literal(scope),
};
const pages = z.array(IndianriverPageSchema).max(INDIANRIVER_MAX_PAGES);
const schema = z.discriminatedUnion("phase", [
  z.object({ ...base, phase: z.literal("owner") }).strict(),
  z
    .object({
      ...base,
      phase: z.literal("opening"),
      ownerHash: hash,
      opening: pages,
    })
    .strict(),
  z
    .object({
      ...base,
      phase: z.literal("closing"),
      ownerHash: hash,
      opening: pages,
      closing: pages,
    })
    .strict(),
  z
    .object({
      ...base,
      phase: z.literal("owner-closing"),
      ownerHash: hash,
      opening: pages,
      closing: pages,
    })
    .strict(),
  z.object({ ...base, phase: z.literal("complete") }).strict(),
]);
export type IndianriverState = z.infer<typeof schema>;
export type IndianriverCursor = IndianriverState & { checksum: string };
export const indianriverRequiredReport = (pages: readonly IndianriverPage[]) =>
  pages.map((p) => ({
    index: p.index,
    total: p.total,
    records: p.records.map((r) => [
      r.id,
      r.vin.toUpperCase(),
      r.year,
      r.make,
      r.model,
    ]),
  }));
function prefix(values: readonly IndianriverPage[], complete: boolean): void {
  const first = values[0];
  if (!first) {
    if (complete)
      throw new Error(
        "Indian River complete checkpoint has no inventory pages",
      );
    return;
  }
  const count = Math.ceil(first.total / INDIANRIVER_PAGE_SIZE);
  if (
    values.length > count ||
    (complete && values.length !== count) ||
    (!complete && values.length >= count) ||
    values.some(
      (p, i) =>
        p.index !== i ||
        p.total !== first.total ||
        p.records.length !==
          Math.min(
            INDIANRIVER_PAGE_SIZE,
            first.total - i * INDIANRIVER_PAGE_SIZE,
          ),
    )
  )
    throw new Error(
      "Indian River checkpoint lost its exact complete native page prefix",
    );
  const ids = values.flatMap((p) => p.records.map((r) => r.id));
  if (new Set(ids).size !== ids.length)
    throw new Error("Indian River checkpoint repeats a native row ID");
}
function checkpoint(state: IndianriverState): IndianriverCursor {
  const parsed = schema.parse(state);
  if (
    "ownerHash" in parsed &&
    parsed.ownerHash !== indianriverHash(INDIANRIVER_YARD)
  )
    throw new Error("Indian River checkpoint owner changed");
  if (parsed.phase === "opening") prefix(parsed.opening, false);
  if (parsed.phase === "closing" || parsed.phase === "owner-closing") {
    prefix(parsed.opening, true);
    prefix(parsed.closing, parsed.phase === "owner-closing");
    for (let i = 0; i < parsed.closing.length; i++) {
      const opening = parsed.opening[i],
        closing = parsed.closing[i];
      if (
        !opening ||
        !closing ||
        indianriverHash(indianriverRequiredReport([opening])) !==
          indianriverHash(indianriverRequiredReport([closing]))
      )
        throw new Error(
          "Indian River closing census changed required identities, row IDs, order, multiplicities or total; no inventory was emitted",
        );
    }
  }
  return { ...parsed, checksum: indianriverHash(parsed) };
}
export const IndianriverCursor = {
  initial: (): IndianriverCursor =>
    checkpoint({ source: "indianriver", version: 1, scope, phase: "owner" }),
  checkpoint,
  parse(input: unknown): IndianriverCursor {
    if (Buffer.byteLength(JSON.stringify(input)) > 8 * 1024 * 1024)
      throw new Error("Indian River checkpoint exceeds 8 MiB");
    const { checksum, ...rest } = z
      .object({ checksum: hash })
      .passthrough()
      .parse(input);
    const parsed = checkpoint(schema.parse(rest));
    if (checksum !== parsed.checksum)
      throw new Error(
        "Indian River checkpoint checksum changed; retain the last validated checkpoint",
      );
    return parsed;
  },
} as const;
