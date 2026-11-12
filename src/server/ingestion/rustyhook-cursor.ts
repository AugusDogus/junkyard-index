import { z } from "zod";
import {
  RustyhookCatalogSchema,
  RustyhookRecordSchema,
  RUSTYHOOK_MAX_DONORS,
  RUSTYHOOK_MAX_PAGES,
  rustyhookCatalogMembership,
  rustyhookHash,
  rustyhookImageBound,
} from "./rustyhook-parser";
import {
  rustyhookRecordVins,
  transformRustyhookRecord,
} from "./rustyhook-transform";
import { RUSTYHOOK_CATALOG, RUSTYHOOK_YARD } from "./rustyhook-yard-metadata";
import { SourceValidationPolicy } from "./source-validation";

export const RUSTYHOOK_MAX_CURSOR_BYTES = 1024 * 1024;
export const RUSTYHOOK_MAX_RUN_BYTES = 32 * 1024 * 1024;
export const RUSTYHOOK_MAX_RUN_REQUESTS =
  RUSTYHOOK_MAX_DONORS + RUSTYHOOK_MAX_PAGES * 2;
export const RUSTYHOOK_CURSOR_SCOPE = rustyhookHash({
  version: 1,
  yard: RUSTYHOOK_YARD,
  root: RUSTYHOOK_CATALOG,
  contract:
    "literal-ordered-pittsburgh-members/native-fields/all-page-closing/no-vin-repair-v1",
});
const common = {
  source: z.literal("rustyhook"),
  version: z.literal(1),
  scope: z.literal(RUSTYHOOK_CURSOR_SCOPE),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  pages: z.array(RustyhookCatalogSchema).max(RUSTYHOOK_MAX_PAGES),
  records: z.array(RustyhookRecordSchema).max(RUSTYHOOK_MAX_DONORS),
  closing: z.array(RustyhookCatalogSchema).max(RUSTYHOOK_MAX_PAGES),
};
const stateSchema = z.discriminatedUnion("phase", [
  z.object({ ...common, phase: z.literal("catalog") }).strict(),
  z.object({ ...common, phase: z.literal("details") }).strict(),
  z.object({ ...common, phase: z.literal("closing") }).strict(),
  z.object({ ...common, phase: z.literal("complete") }).strict(),
]);
type State = z.infer<typeof stateSchema>;
function checksum(state: Omit<State, "checksum">) {
  return rustyhookHash({
    source: state.source,
    version: state.version,
    scope: state.scope,
    phase: state.phase,
    pages: state.pages,
    records: state.records,
    closing: state.closing,
  });
}
const wire = (state: State) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(state).filter(([key]) => key !== "source"),
    ),
  );

/** Recompute the complete trusted prefix, including every rejected identity.
 * The checksum detects corruption; it does not authenticate an external cursor.
 */
export function inspectRustyhookCursor(state: State) {
  const posts = state.pages.flatMap((page) => page.posts);
  const lastPage = state.pages[0]?.lastPage ?? 0;
  const validPages = state.pages.every(
    (page, index) =>
      page.page === index + 1 &&
      page.lastPage === lastPage &&
      page.url ===
        (index === 0
          ? RUSTYHOOK_CATALOG
          : state.pages[index - 1]?.links.find(
              (link) => link.page === index + 1,
            )?.url),
  );
  if (
    !validPages ||
    new Set(posts.map((post) => post.url)).size !== posts.length ||
    posts.length > RUSTYHOOK_MAX_DONORS
  )
    throw new Error(
      "Rusty Hook checkpoint listing prefix or donor URL uniqueness changed",
    );
  const aliases = new Map<number, string>();
  for (const page of state.pages)
    for (const link of page.links) {
      const prior = aliases.get(link.page);
      if (prior && prior !== link.url)
        throw new Error(
          "Rusty Hook published page destination conflicts across listings",
        );
      aliases.set(link.page, link.url);
    }
  const seen = new Set<string>();
  const stocks = new Set<string>();
  const vehicles = [];
  const observedVins = new Set<string>();
  const rejections = [];
  for (const [index, record] of state.records.entries()) {
    if (
      JSON.stringify(record.post) !== JSON.stringify(posts[index]) ||
      record.heading !== record.post.title ||
      record.images.some(
        (image) => !rustyhookImageBound(image, record.fields.VIN ?? ""),
      )
    )
      throw new Error(
        "Rusty Hook checkpoint donor order, heading or optional image binding changed",
      );
    for (const vin of rustyhookRecordVins(record)) {
      if (seen.has(vin))
        throw new Error(
          "Rusty Hook different donor records reuse a native VIN, including rejected identities",
        );
      seen.add(vin);
    }
    const result = transformRustyhookRecord(record);
    if (result.status === "available") {
      const stock = result.vehicle.stockNumber;
      if (stock && stocks.has(stock))
        throw new Error(
          "Rusty Hook different donors reuse a native stock number",
        );
      if (stock) stocks.add(stock);
      vehicles.push(result.vehicle);
    } else {
      rejections.push({ url: record.post.url, reason: result.reason });
      for (const vin of result.observedVins) observedVins.add(vin);
    }
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
        "Rusty Hook checkpoint is not a contiguous complete control prefix",
      );
  }
  for (const [index, page] of state.closing.entries()) {
    const original = state.pages[index];
    if (
      !original ||
      JSON.stringify(rustyhookCatalogMembership(page)) !==
        JSON.stringify(rustyhookCatalogMembership(original))
    )
      throw new Error(
        "Rusty Hook closing listing membership, labels or pagination changed during traversal",
      );
  }
  const receipts = [...state.pages, ...state.records, ...state.closing].map(
    (value) => value.receipt,
  );
  const bytes = receipts.reduce((sum, receipt) => sum + receipt.bytes, 0);
  if (
    receipts.length > RUSTYHOOK_MAX_RUN_REQUESTS ||
    bytes > RUSTYHOOK_MAX_RUN_BYTES
  )
    throw new Error(
      "Rusty Hook run exceeds its request or response-byte capacity",
    );
  if (
    (state.phase === "closing" || state.phase === "complete") &&
    (!vehicles.length ||
      rejections.length / state.records.length >
        SourceValidationPolicy.maximumRejectionRatio)
  )
    throw new Error(
      "Rusty Hook required-field rejection exceeds the unchanged 10% limit or leaves no accepted donor",
    );
  return {
    posts,
    vehicles,
    observedVins: [...observedVins].sort(),
    rejections,
    processed: state.records.length,
    requests: receipts.length,
    bytes,
  };
}
export const RustyhookCursorSchema = stateSchema.superRefine(
  (state, context) => {
    try {
      if (state.checksum !== checksum(state))
        throw new Error("Rusty Hook checkpoint checksum changed");
      if (Buffer.byteLength(wire(state)) > RUSTYHOOK_MAX_CURSOR_BYTES)
        throw new Error(
          "Rusty Hook checkpoint exceeds 1 MiB; inspect source growth before resuming",
        );
      inspectRustyhookCursor(state);
    } catch (cause) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          cause instanceof Error
            ? cause.message
            : "Invalid Rusty Hook checkpoint",
      });
    }
  },
);
export type RustyhookCursor = z.infer<typeof RustyhookCursorSchema>;
function checkpoint(value: Omit<State, "checksum">): RustyhookCursor {
  return RustyhookCursorSchema.parse({ ...value, checksum: checksum(value) });
}
export const RustyhookCursor = {
  initial: checkpoint({
    source: "rustyhook",
    version: 1,
    scope: RUSTYHOOK_CURSOR_SCOPE,
    phase: "catalog",
    pages: [],
    records: [],
    closing: [],
  }),
  checkpoint,
  parse(value: string): RustyhookCursor {
    if (Buffer.byteLength(value) > RUSTYHOOK_MAX_CURSOR_BYTES)
      throw new Error(
        "Rusty Hook serialized checkpoint exceeds 1 MiB; retain the prior checkpoint",
      );
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new Error("Expected a Rusty Hook checkpoint object");
    return RustyhookCursorSchema.parse({ ...parsed, source: "rustyhook" });
  },
  serialize(value: RustyhookCursor): string {
    return wire(RustyhookCursorSchema.parse(value));
  },
} as const;
