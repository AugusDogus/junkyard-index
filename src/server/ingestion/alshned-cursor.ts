import { z } from "zod";
import {
  AlshnedPageSchema,
  AlshnedDonorSchema,
  AlshnedCatalog,
  alshnedHash,
  ALSHNED_CATALOG,
  ALSHNED_OWNER_HASH,
  type AlshnedPage,
} from "./alshned-parser";
import { alshnedSnapshot, validateAlshnedSnapshot } from "./alshned-transform";
import { ALSHNED_YARD } from "./alshned-yard-metadata";

export const ALSHNED_MAX_CURSOR_BYTES = 8 * 1024 * 1024;
export const ALSHNED_MAX_RUN_BYTES = 512 * 1024 * 1024;
export const ALSHNED_MAX_RUN_MS = 2 * 60 * 60 * 1000;
const scope = alshnedHash({
  version: 1,
  yard: ALSHNED_YARD,
  catalog: ALSHNED_CATALOG,
  contract:
    "all-native-donor-details/required-claims/no-inference/closing-membership-v1",
});
const base = {
  source: z.literal("alshned"),
  version: z.literal(1),
  scope: z.literal(scope),
};
const run = {
  ...base,
  startedAt: z.number().int().nonnegative(),
  previousAcceptedCount: z.number().int().nonnegative().nullable(),
  ownerHash: z.literal(ALSHNED_OWNER_HASH),
  ownerBytes: z
    .number()
    .int()
    .min(1)
    .max(2 * 1024 * 1024),
  pages: z.array(AlshnedPageSchema).max(1000),
};
const detail = { ...run, donors: z.array(AlshnedDonorSchema).max(24000) };
const closing = { ...detail, closing: z.array(AlshnedPageSchema).max(1000) };
const schema = z.discriminatedUnion("phase", [
  z.object({ ...base, phase: z.literal("owner") }).strict(),
  z.object({ ...run, phase: z.literal("catalog") }).strict(),
  z.object({ ...detail, phase: z.literal("details") }).strict(),
  z.object({ ...closing, phase: z.literal("closing") }).strict(),
  z.object({ ...closing, phase: z.literal("complete") }).strict(),
]);
export type AlshnedState = z.infer<typeof schema>;
export type AlshnedCursor = AlshnedState & { checksum: string };
export function inspectAlshnedPages(
  pages: readonly AlshnedPage[],
  complete: boolean,
) {
  const first = pages[0],
    cards = pages.flatMap((p) => p.cards);
  if (
    pages.some(
      (p, i) =>
        p.page !== i + 1 ||
        p.total !== first?.total ||
        p.lastPage !== first.lastPage ||
        p.url !== (i === 0 ? ALSHNED_CATALOG : pages[i - 1]?.next),
    ) ||
    new Set(cards.map((c) => c.handle)).size !== cards.length ||
    (complete
      ? !first ||
        pages.length !== first.lastPage ||
        cards.length !== first.total ||
        pages.at(-1)?.next !== null
      : first &&
        (pages.length >= first.lastPage || pages.at(-1)?.next === null))
  )
    throw new Error(
      "Alshned checkpoint lost its contiguous, unique native page frontier",
    );
  return cards;
}
function validate(state: AlshnedState) {
  if (state.phase === "owner") return;
  const cards = inspectAlshnedPages(state.pages, state.phase !== "catalog");
  let bytes = state.ownerBytes + state.pages.reduce((n, p) => n + p.bytes, 0);
  if (state.phase !== "catalog") {
    if (
      state.donors.some(
        (d, i) => alshnedHash(d.card) !== alshnedHash(cards[i]),
      ) ||
      (state.phase === "details"
        ? state.donors.length >= cards.length
        : state.donors.length !== cards.length)
    )
      throw new Error(
        "Alshned checkpoint skips, duplicates or changes ordered primary donors",
      );
    bytes += state.donors.reduce((n, d) => n + d.bytes, 0);
  }
  if (state.phase === "closing" || state.phase === "complete") {
    validateAlshnedSnapshot(
      alshnedSnapshot(state.pages, state.donors),
      state.previousAcceptedCount,
    );
    if (
      (state.phase === "complete"
        ? state.closing.length !== state.pages.length
        : state.closing.length >= state.pages.length) ||
      state.closing.some(
        (p, i) =>
          alshnedHash(AlshnedCatalog.membership(p)) !==
          alshnedHash(
            state.pages[i] ? AlshnedCatalog.membership(state.pages[i]) : null,
          ),
      )
    )
      throw new Error(
        "Alshned closing membership, required titles or pagination changed",
      );
    bytes += state.closing.reduce((n, p) => n + p.bytes, 0);
  }
  if (bytes > ALSHNED_MAX_RUN_BYTES)
    throw new Error(
      "Alshned source run exceeded its complete-response byte bound",
    );
}
function checkpoint(input: AlshnedState): AlshnedCursor {
  const state = schema.parse(
    Object.fromEntries(
      Object.entries(input).filter(([key]) => key !== "checksum"),
    ),
  );
  validate(state);
  const result = { ...state, checksum: alshnedHash(state) };
  if (Buffer.byteLength(JSON.stringify(result)) > ALSHNED_MAX_CURSOR_BYTES)
    throw new Error(
      "Alshned checkpoint exceeds 8MiB; prior checkpoint is preserved",
    );
  return result;
}
export const AlshnedCursor = {
  initial: checkpoint({ source: "alshned", version: 1, scope, phase: "owner" }),
  checkpoint,
  parse(input: unknown): AlshnedCursor {
    if (Buffer.byteLength(JSON.stringify(input)) > ALSHNED_MAX_CURSOR_BYTES)
      throw new Error("Alshned checkpoint exceeds 8MiB");
    const { checksum, ...rest } = z
      .object({ checksum: z.string().regex(/^[a-f0-9]{64}$/) })
      .passthrough()
      .parse(input);
    const parsed = checkpoint(schema.parse(rest));
    if (checksum !== parsed.checksum)
      throw new Error(
        "Alshned checkpoint checksum changed; retain the previous checkpoint",
      );
    return parsed;
  },
  start(
    ownerHash: string,
    ownerBytes: number,
    previousAcceptedCount: number | null,
  ): AlshnedCursor {
    return checkpoint({
      ...AlshnedCursor.initial,
      phase: "catalog",
      startedAt: Date.now(),
      ownerHash,
      ownerBytes,
      previousAcceptedCount,
      pages: [],
    });
  },
} as const;
