import { z } from "zod";
import {
  KANDR_CONTROLS,
  KANDR_MAX_BODY_BYTES,
  KandrNative,
  kandrHash,
  type KandrListing,
  type KandrDetail,
} from "./kandr-native";
import { KandrReceiptSchema, type KandrReceipt } from "./kandr-record";
import {
  kandrBoundary,
  kandrScope,
  type KandrContract,
} from "./kandr-contract";

export const KANDR_MAX_REQUESTS = 512;
export const KANDR_MAX_TOTAL_BYTES = 128 * 1024 * 1024;
export const KANDR_MAX_CURSOR_BYTES = 4 * 1024 * 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const base = {
  source: z.literal("kandr"),
  version: z.literal(1),
  scope: hash,
  checksum: hash,
  requests: z.number().int().nonnegative().max(KANDR_MAX_REQUESTS),
  bytes: z.number().int().nonnegative().max(KANDR_MAX_TOTAL_BYTES),
};
const schema = z.discriminatedUnion("phase", [
  z
    .object({
      ...base,
      phase: z.literal("collecting"),
      receipts: z.array(KandrReceiptSchema).max(KANDR_MAX_REQUESTS),
    })
    .strict(),
  z.object({ ...base, phase: z.literal("complete") }).strict(),
]);
export type KandrCursor = z.infer<typeof schema>;
interface Graph {
  controls: string[] | null;
  pages: KandrListing[];
  details: KandrDetail[];
  closing: KandrListing[];
}
type Next =
  | { kind: "controls" | "listing" | "detail" | "closing"; url: string }
  | { kind: "ready" };
const checksum = (cursor: KandrCursor) =>
  kandrHash({ ...cursor, checksum: undefined });

function next(graph: Graph): Next {
  if (graph.controls === null) return { kind: "controls", url: KANDR_CONTROLS };
  const last = graph.pages.at(-1);
  const listingUrl = !last
    ? graph.controls[0]
    : (last.nextUrl ?? (last.category === "99994" ? graph.controls[1] : null));
  if (listingUrl) return { kind: "listing", url: listingUrl };
  const card = graph.pages.flatMap((page) => page.cards)[graph.details.length];
  if (card) return { kind: "detail", url: card.url };
  const closing = graph.pages[graph.closing.length];
  return closing ? { kind: "closing", url: closing.url } : { kind: "ready" };
}
function validatePage(page: KandrListing) {
  const source = KandrNative.destination(page.url, false);
  if (
    source.url !== page.url ||
    page.category !== source.category ||
    page.page !== source.page ||
    page.lastPage !== Math.ceil(page.total / 25) ||
    page.page > page.lastPage ||
    page.cards.length !== Math.min(25, page.total - (page.page - 1) * 25) ||
    (page.nextUrl === null) !== (page.page === page.lastPage) ||
    page.fingerprint !== kandrHash({ ...page, fingerprint: undefined })
  )
    throw new Error(
      "Checkpoint listing identity, counts, terminal evidence or fingerprint changed",
    );
  if (page.nextUrl !== null) {
    const dest = KandrNative.destination(page.nextUrl, false);
    if (
      dest.url !== page.nextUrl ||
      dest.category !== page.category ||
      dest.page !== page.page + 1
    )
      throw new Error("Checkpoint pagination left its literal donor category");
  }
  if (new Set(page.cards.map((card) => card.id)).size !== page.cards.length)
    throw new Error("Checkpoint repeats a native donor identifier");
  for (const card of page.cards) {
    const dest = KandrNative.destination(card.url, true);
    if (
      dest.url !== card.url ||
      dest.id !== card.id ||
      dest.category !== page.category ||
      dest.page !== page.page
    )
      throw new Error(
        "Checkpoint donor destination left its native listing parent",
      );
  }
}
function replay(receipts: readonly KandrReceipt[]): Graph {
  const graph: Graph = { controls: null, pages: [], details: [], closing: [] };
  for (const receipt of receipts) {
    const expected = next(graph);
    if (expected.kind === "ready" || expected.kind !== receipt.kind)
      throw new Error(
        "Checkpoint skipped or reordered the required native traversal",
      );
    if (receipt.kind === "controls") {
      for (const [index, url] of receipt.urls.entries()) {
        const dest = KandrNative.destination(url, false);
        if (
          dest.url !== url ||
          dest.page !== 1 ||
          dest.category !== ["99994", "99992"][index]
        )
          throw new Error(
            "Checkpoint controls changed donor categories or default filters",
          );
      }
      graph.controls = receipt.urls;
    } else if (receipt.kind === "listing" || receipt.kind === "closing") {
      const page = receipt.page;
      validatePage(page);
      if (page.url !== expected.url)
        throw new Error("Checkpoint listing left its published edge");
      if (receipt.kind === "closing") {
        const opening = graph.pages[graph.closing.length];
        if (!opening || page.fingerprint !== opening.fingerprint)
          throw new Error(
            "K&R opening/closing inventory changed; discard this snapshot and preserve prior inventory",
          );
        graph.closing.push(page);
      } else {
        const siblings = graph.pages.filter(
          (p) => p.category === page.category,
        );
        const seen = new Set(
          siblings.flatMap((p) => p.cards.map((card) => card.id)),
        );
        if (
          siblings.some((p) => p.total !== page.total) ||
          page.cards.some((card) => seen.has(card.id))
        )
          throw new Error(
            "K&R category counts changed or native pages overlap",
          );
        graph.pages.push(page);
      }
    } else if (receipt.kind === "detail") {
      const detail = receipt.detail;
      const source = KandrNative.destination(detail.url, true);
      const card = graph.pages.flatMap((page) => page.cards)[
        graph.details.length
      ];
      if (
        !card ||
        detail.url !== expected.url ||
        source.url !== detail.url ||
        source.id !== detail.id ||
        detail.id !== card.id ||
        detail.category !== source.category ||
        detail.images.some((raw) => {
          const image = URL.parse(raw);
          return (
            !image ||
            image.origin !== "https://imagehost.heavytruckparts.net" ||
            image.username ||
            image.password ||
            image.search ||
            image.hash ||
            !new RegExp(`_${detail.id.replaceAll("/", "_")}_\\d+\\.jpg$`).test(
              image.pathname,
            )
          );
        })
      )
        throw new Error(
          "Checkpoint detail identity, destination or bound photo changed",
        );
      graph.details.push(detail);
    }
  }
  return graph;
}
function validate(input: unknown, contract: KandrContract): KandrCursor {
  if (Buffer.byteLength(JSON.stringify(input)) > KANDR_MAX_CURSOR_BYTES)
    throw new Error("Checkpoint exceeds the 4 MiB wire bound");
  const cursor = schema.parse(input);
  if (
    cursor.scope !== kandrScope(contract) ||
    cursor.checksum !== checksum(cursor)
  )
    throw new Error(
      "Checkpoint source, qualification scope or integrity changed",
    );
  if (cursor.phase === "complete") {
    if (cursor.requests < 7 || cursor.bytes < cursor.requests)
      throw new Error("Terminal checkpoint request/byte accounting is invalid");
  } else {
    replay(cursor.receipts);
    if (
      cursor.requests !== cursor.receipts.length ||
      cursor.bytes !== cursor.receipts.reduce((sum, r) => sum + r.bytes, 0)
    )
      throw new Error(
        "Checkpoint accounting differs from its validated native receipts",
      );
  }
  return cursor;
}
function checkpoint(input: unknown, contract: KandrContract) {
  const unsigned = schema.parse({
    ...z.record(z.string(), z.unknown()).parse(input),
    checksum: "0".repeat(64),
  });
  return validate({ ...unsigned, checksum: checksum(unsigned) }, contract);
}
export const KandrCursor = {
  initial(contract: KandrContract) {
    return kandrBoundary("initial checkpoint", () =>
      checkpoint(
        {
          source: "kandr",
          version: 1,
          scope: kandrScope(contract),
          requests: 0,
          bytes: 0,
          phase: "collecting",
          receipts: [],
        },
        contract,
      ),
    );
  },
  parse(input: unknown, contract: KandrContract) {
    return kandrBoundary("checkpoint", () => validate(input, contract));
  },
  fromWire(raw: string, contract: KandrContract) {
    return kandrBoundary("checkpoint wire", () => {
      if (Buffer.byteLength(raw) > KANDR_MAX_CURSOR_BYTES)
        throw new Error("Checkpoint wire exceeds 4 MiB");
      return validate(JSON.parse(raw), contract);
    });
  },
  serialize(cursor: KandrCursor, contract: KandrContract) {
    return kandrBoundary("checkpoint serialization", () =>
      JSON.stringify(validate(cursor, contract)),
    );
  },
  next(cursor: KandrCursor) {
    return cursor.phase === "complete"
      ? { kind: "ready" as const }
      : next(replay(cursor.receipts));
  },
  snapshotGraph(cursor: KandrCursor) {
    return kandrBoundary("complete native graph", () => {
      if (cursor.phase === "complete")
        throw new Error("Terminal checkpoint has already delivered its batch");
      const graph = replay(cursor.receipts);
      if (next(graph).kind !== "ready")
        throw new Error("Native graph is incomplete");
      return { pages: graph.pages, details: graph.details };
    });
  },
  advance(cursor: KandrCursor, raw: string, contract: KandrContract) {
    return kandrBoundary("native graph transition", () => {
      const checked = validate(cursor, contract);
      if (checked.phase === "complete")
        throw new Error("Terminal checkpoint cannot read more pages");
      const edge = next(replay(checked.receipts));
      if (edge.kind === "ready")
        throw new Error("Complete native graph cannot read more pages");
      const evidence = {
        bodyHash: kandrHash(raw),
        bytes: Buffer.byteLength(raw),
      };
      if (!evidence.bytes || evidence.bytes > KANDR_MAX_BODY_BYTES)
        throw new Error("Native response is empty or exceeds 2 MiB");
      const receipt: KandrReceipt =
        edge.kind === "controls"
          ? { kind: "controls", ...evidence, urls: KandrNative.controls(raw) }
          : edge.kind === "detail"
            ? {
                kind: "detail",
                ...evidence,
                detail: KandrNative.detail(raw, edge.url),
              }
            : {
                kind: edge.kind,
                ...evidence,
                page: KandrNative.listing(raw, edge.url),
              };
      return checkpoint(
        {
          ...checked,
          requests: checked.requests + 1,
          bytes: checked.bytes + evidence.bytes,
          receipts: [...checked.receipts, receipt],
        },
        contract,
      );
    });
  },
  complete(cursor: KandrCursor, contract: KandrContract) {
    return kandrBoundary("terminal checkpoint", () => {
      const checked = validate(cursor, contract);
      if (
        checked.phase !== "collecting" ||
        next(replay(checked.receipts)).kind !== "ready"
      )
        throw new Error("Native traversal is not closed");
      return checkpoint(
        {
          source: checked.source,
          version: checked.version,
          scope: checked.scope,
          requests: checked.requests,
          bytes: checked.bytes,
          phase: "complete",
        },
        contract,
      );
    });
  },
} as const;
