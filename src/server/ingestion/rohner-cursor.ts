import { z } from "zod";
import {
  RohnerArticleResultSchema,
  RohnerCatalogSchema,
  ROHNER_MAX_DONORS,
  ROHNER_MAX_PAGES,
  rohnerCatalogMembership,
  rohnerCatalogPage,
  rohnerHash,
} from "./rohner-parser";
import {
  rohnerInventorySnapshot,
  validateRohnerInventorySnapshot,
} from "./rohner-transform";
import { ROHNER_CATALOG, ROHNER_YARD } from "./rohner-yard-metadata";

// The real 287-article required-field oracle is about 3 MiB before catalogs.
// Keep native claims through completion, including rejects and sold exclusions.
export const ROHNER_MAX_CURSOR_BYTES = 16 * 1024 * 1024;
export const ROHNER_MAX_RUN_BYTES = 256 * 1024 * 1024;
export const ROHNER_MAX_RUN_REQUESTS = ROHNER_MAX_DONORS + ROHNER_MAX_PAGES * 2;
export const ROHNER_CURSOR_SCOPE = rohnerHash({
  version: 1,
  yard: ROHNER_YARD,
  root: ROHNER_CATALOG,
  contract:
    "native-required-claims/sold-after-quarantine/all-page-membership-v1",
});
const common = {
  source: z.literal("rohner"),
  version: z.literal(1),
  scope: z.literal(ROHNER_CURSOR_SCOPE),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  pages: z.array(RohnerCatalogSchema).max(ROHNER_MAX_PAGES),
  records: z.array(RohnerArticleResultSchema).max(ROHNER_MAX_DONORS),
  closing: z.array(RohnerCatalogSchema).max(ROHNER_MAX_PAGES),
};
const stateSchema = z.discriminatedUnion("phase", [
  z.object({ ...common, phase: z.literal("catalog") }).strict(),
  z.object({ ...common, phase: z.literal("details") }).strict(),
  z.object({ ...common, phase: z.literal("closing") }).strict(),
  z.object({ ...common, phase: z.literal("complete") }).strict(),
]);
type State = z.infer<typeof stateSchema>;
const checksum = (state: Omit<State, "checksum">) =>
  rohnerHash({
    source: state.source,
    version: state.version,
    scope: state.scope,
    phase: state.phase,
    pages: state.pages,
    records: state.records,
    closing: state.closing,
  });
const wire = (state: State) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(state).filter(([key]) => key !== "source"),
    ),
  );

/** Validate the entire durable prefix. Closing observations check membership;
 * they do not claim a provider-wide atomic snapshot. Checksums detect corruption,
 * not malicious replacement of externally supplied native evidence.
 */
export function inspectRohnerCursor(state: State) {
  const first = state.pages[0];
  const posts = state.pages.flatMap((page) => page.posts);
  const lastPage = first?.lastPage ?? 0;
  if (
    state.pages.some(
      (page, index) =>
        page.page !== index + 1 ||
        page.lastPage !== lastPage ||
        page.range.total !== first?.range.total ||
        page.url !==
          (index === 0
            ? ROHNER_CATALOG
            : state.pages[index - 1]?.links.find(
                (link) => rohnerCatalogPage(link.href) === index + 1,
              )?.href),
    ) ||
    new Set(posts.map((post) => post.url)).size !== posts.length ||
    posts.length > ROHNER_MAX_DONORS
  )
    throw new Error(
      "Rohner checkpoint listing prefix, native totals or donor URL uniqueness changed",
    );
  const aliases = new Map<number, string>();
  for (const page of state.pages)
    for (const link of page.links) {
      const number = rohnerCatalogPage(link.href);
      if (number === null)
        throw new Error("Rohner checkpoint contains a foreign pagination URL");
      const previous = aliases.get(number);
      if (previous && previous !== link.href)
        throw new Error(
          "Rohner native page destinations conflict across listings",
        );
      aliases.set(number, link.href);
    }
  for (const [index, record] of state.records.entries()) {
    const post = posts[index];
    if (
      !post ||
      record.detailsUrl !== post.url ||
      record.cards.length !== 1 ||
      record.cards[0] !== post.card.id
    )
      throw new Error(
        "Rohner checkpoint donor order or native card binding changed",
      );
    const cardClaims = [
      ...post.card.titles.map((value) => ({
        boundary: post.card.id + ":title",
        value,
      })),
      ...post.card.imageOccurrences.flatMap((image) =>
        ["alt", "title"].flatMap((key) =>
          image[key]
            ? [{ boundary: post.card.id + ":image-" + key, value: image[key] }]
            : [],
        ),
      ),
    ];
    const retained = record.nativeNamedClaims
      .filter((claim) => claim.boundary.startsWith(post.card.id + ":"))
      .map(({ boundary, value }) => ({ boundary, value }));
    if (JSON.stringify(cardClaims) !== JSON.stringify(retained))
      throw new Error(
        "Rohner checkpoint lost the donor's native card identity claims",
      );
  }
  const lengths = [
    state.pages.length,
    state.records.length,
    state.closing.length,
  ];
  const totals = [lastPage, posts.length, lastPage];
  const phase = ["catalog", "details", "closing", "complete"].indexOf(
    state.phase,
  );
  for (const [index, length] of lengths.entries()) {
    const total = totals[index] ?? 0;
    const valid =
      index < phase
        ? length === total && total > 0
        : index === phase
          ? length < total || (state.phase === "catalog" && length === 0)
          : length === 0;
    if (!valid)
      throw new Error(
        "Rohner checkpoint is not a contiguous complete control prefix",
      );
  }
  if (
    state.phase !== "catalog" &&
    (!first || posts.length !== first.range.total)
  )
    throw new Error(
      "Rohner complete listing graph disagrees with its native total",
    );
  for (const [index, page] of state.closing.entries()) {
    const opening = state.pages[index];
    if (
      !opening ||
      JSON.stringify(rohnerCatalogMembership(page)) !==
        JSON.stringify(rohnerCatalogMembership(opening))
    )
      throw new Error(
        "Rohner closing listing membership, native claims or pagination changed during traversal",
      );
  }
  const receipts = [
    ...state.pages.map((page) => page.receipt),
    ...state.records.map((record) => record.rawBody),
    ...state.closing.map((page) => page.receipt),
  ];
  const bytes = receipts.reduce((sum, receipt) => sum + receipt.bytes, 0);
  if (receipts.length > ROHNER_MAX_RUN_REQUESTS || bytes > ROHNER_MAX_RUN_BYTES)
    throw new Error("Rohner run exceeds its request or response-byte capacity");
  const snapshot = rohnerInventorySnapshot(state.records);
  if (state.phase === "closing" || state.phase === "complete")
    validateRohnerInventorySnapshot(snapshot);
  return { posts, ...snapshot, requests: receipts.length, bytes };
}

export const RohnerCursorSchema = stateSchema.superRefine((state, context) => {
  try {
    if (state.checksum !== checksum(state))
      throw new Error("Rohner checkpoint checksum changed");
    if (Buffer.byteLength(wire(state)) > ROHNER_MAX_CURSOR_BYTES)
      throw new Error(
        "Rohner checkpoint exceeds 16 MiB; inspect source growth before resuming",
      );
    inspectRohnerCursor(state);
  } catch (cause) {
    context.addIssue({
      code: "custom",
      message:
        cause instanceof Error ? cause.message : "Invalid Rohner checkpoint",
    });
  }
});
export type RohnerCursor = z.infer<typeof RohnerCursorSchema>;
function checkpoint(value: Omit<State, "checksum">): RohnerCursor {
  const parsed = stateSchema.parse({ ...value, checksum: "0".repeat(64) });
  return RohnerCursorSchema.parse({ ...parsed, checksum: checksum(parsed) });
}
export const RohnerCursor = {
  initial: checkpoint({
    source: "rohner",
    version: 1,
    scope: ROHNER_CURSOR_SCOPE,
    phase: "catalog",
    pages: [],
    records: [],
    closing: [],
  }),
  checkpoint,
  parse(value: string): RohnerCursor {
    if (Buffer.byteLength(value) > ROHNER_MAX_CURSOR_BYTES)
      throw new Error("Rohner checkpoint wire payload exceeds 16 MiB");
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Expected a Rohner checkpoint object");
    return RohnerCursorSchema.parse({ ...parsed, source: "rohner" });
  },
  serialize(value: RohnerCursor): string {
    return wire(RohnerCursorSchema.parse(value));
  },
} as const;
