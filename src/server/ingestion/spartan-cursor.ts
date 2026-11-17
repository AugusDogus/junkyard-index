import { z } from "zod";
import { SpartanPageSchema, type SpartanPage } from "./spartan-parser";
import { shopifyYardHash } from "./shopify-yard-cursor";
import {
  SPARTAN_API,
  SPARTAN_MINIMUM,
  SPARTAN_OWNER,
  SPARTAN_YARD,
} from "./spartan-yard-metadata";

const pages = z.array(SpartanPageSchema).max(400);
const active = { startedAt: z.number().int().positive(), pages };
const state = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("owner") }).strict(),
  z.object({ phase: z.literal("opening"), ...active }).strict(),
  z
    .object({
      phase: z.literal("closing"),
      ...active,
      closed: z.number().int().nonnegative().max(400),
    })
    .strict(),
  z.object({ phase: z.literal("owner-closing"), ...active }).strict(),
  z.object({ phase: z.literal("complete") }).strict(),
]);
type State = z.infer<typeof state>;

export function spartanNextPage(pages: readonly SpartanPage[]) {
  const last = pages.at(-1);
  if (!last) return { kind: "auto", page: 1 } as const;
  if (last.page < last.last) return { kind: last.kind, page: last.page + 1 };
  return last.kind === "auto" ? ({ kind: "truck", page: 1 } as const) : null;
}

const scope = shopifyYardHash({
  version: 1,
  SPARTAN_API,
  SPARTAN_OWNER,
  SPARTAN_YARD,
  SPARTAN_MINIMUM,
});
function checkpoint(input: State) {
  const parsed = state.parse(input);
  if (parsed.phase !== "owner" && parsed.phase !== "complete") {
    const previous: SpartanPage[] = [];
    const ids = new Set<number>();
    for (const page of parsed.pages) {
      const expected = spartanNextPage(previous);
      const first = previous.find((p) => p.kind === page.kind);
      if (
        !expected ||
        page.kind !== expected.kind ||
        page.page !== expected.page ||
        (first && (first.total !== page.total || first.last !== page.last)) ||
        page.rows.length !== Math.min(12, page.total - (page.page - 1) * 12) ||
        page.last !== Math.ceil(page.total / 12) ||
        page.rows.some((row) => row.type !== page.kind || ids.has(row.id))
      )
        throw new Error(
          "Spartan checkpoint skips, repeats or changes a native page; restart the complete census.",
        );
      for (const row of page.rows) {
        if (ids.has(row.id))
          throw new Error(
            "Spartan checkpoint repeats a donor destination; restart the complete census.",
          );
        ids.add(row.id);
      }
      previous.push(page);
    }
    const next = spartanNextPage(parsed.pages);
    if (
      (parsed.phase === "opening") !== (next !== null) ||
      (parsed.phase === "closing" && parsed.closed >= parsed.pages.length)
    )
      throw new Error(
        "Spartan checkpoint has an inconsistent census phase; retain the last valid checkpoint.",
      );
  }
  const value = {
    ...parsed,
    source: "spartan" as const,
    version: 1 as const,
    scope,
  };
  return { ...value, checksum: shopifyYardHash(value) };
}

export type SpartanCursor = ReturnType<typeof checkpoint>;
export const SpartanCursor = {
  initial: () => checkpoint({ phase: "owner" }),
  checkpoint,
  fromWire(wire: string): SpartanCursor {
    if (Buffer.byteLength(wire) > 2 * 1024 * 1024)
      throw new Error(
        "Spartan serialized checkpoint exceeds 2 MiB; inspect source growth before resuming.",
      );
    const input: unknown = JSON.parse(wire);
    return SpartanCursor.parse(input);
  },
  serialize(cursor: SpartanCursor) {
    return JSON.stringify(SpartanCursor.parse(cursor));
  },
  parse(input: unknown): SpartanCursor {
    if (Buffer.byteLength(JSON.stringify(input)) > 2 * 1024 * 1024)
      throw new Error(
        "Spartan checkpoint exceeds 2 MiB; inspect source growth before resuming.",
      );
    const wire = z
      .object({
        source: z.literal("spartan"),
        version: z.literal(1),
        scope: z.literal(scope),
        checksum: z.string(),
      })
      .passthrough()
      .parse(input);
    const { source, version, scope: nativeScope, checksum, ...rest } = wire;
    void source;
    void version;
    void nativeScope;
    const parsed = checkpoint(state.parse(rest));
    if (parsed.checksum !== checksum)
      throw new Error(
        "Spartan checkpoint checksum changed; retain the last valid checkpoint.",
      );
    return parsed;
  },
} as const;
