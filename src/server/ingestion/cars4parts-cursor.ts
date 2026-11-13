import { z } from "zod";
import {
  Cars4PartsContractSchema,
  type Cars4PartsContract,
} from "./cars4parts-contract";
import {
  CARS4PARTS_MAX_BODY_BYTES,
  cars4partsLeafUrl,
} from "./cars4parts-html";
import { Cars4PartsPageSchema, cars4partsHash } from "./cars4parts-parser";
import { Cars4PartsRecordSchema } from "./cars4parts-record";
import { Cars4PartsResult } from "./cars4parts-result";

export const CARS4PARTS_MAX_REQUESTS = 1024;
export const CARS4PARTS_MAX_TOTAL_BYTES = 128 * 1024 * 1024;
export const CARS4PARTS_MAX_CURSOR_BYTES = 8 * 1024 * 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const base = {
  source: z.literal("cars4parts"),
  version: z.literal(1),
  scope: hash,
  checksum: hash,
  requests: z.number().int().min(0).max(CARS4PARTS_MAX_REQUESTS),
  bytes: z.number().int().min(0).max(CARS4PARTS_MAX_TOTAL_BYTES),
};
const inventory = {
  makes: z.array(z.string().min(1).max(200)).min(1).max(256),
  inventoryHash: hash,
};
const pages = { ...inventory, pages: z.array(Cars4PartsPageSchema).max(200) };
const records = {
  ...pages,
  records: z.array(Cars4PartsRecordSchema).max(1000),
};
const schema = z.discriminatedUnion("phase", [
  z.object({ ...base, phase: z.literal("inventory") }).strict(),
  z.object({ ...base, ...pages, phase: z.literal("opening") }).strict(),
  z.object({ ...base, ...records, phase: z.literal("leaves") }).strict(),
  z
    .object({
      ...base,
      ...records,
      phase: z.literal("closing"),
      closed: z.number().int().min(0).max(200),
    })
    .strict(),
  z
    .object({
      ...base,
      ...records,
      phase: z.literal("ready"),
      closed: z.number().int().min(1).max(200),
    })
    .strict(),
  z.object({ ...base, phase: z.literal("complete") }).strict(),
]);
export type Cars4PartsCursor = z.infer<typeof schema>;
export type Cars4PartsUnsignedCursor<Cursor = Cars4PartsCursor> =
  Cursor extends { checksum: string } ? Omit<Cursor, "checksum"> : never;
const checksum = (cursor: Cars4PartsCursor) =>
  cars4partsHash({ ...cursor, checksum: undefined });
export const cars4partsLeafDestinations = (
  state: Pick<z.infer<typeof Cars4PartsPageSchema>, "rows">[],
) => [
  ...new Set(state.flatMap((page) => page.rows.map((row) => row.destination))),
];

function validate(
  input: unknown,
  contract: Cars4PartsContract,
): Cars4PartsCursor {
  const scope = cars4partsHash(Cars4PartsContractSchema.parse(contract));
  if (Buffer.byteLength(JSON.stringify(input)) > CARS4PARTS_MAX_CURSOR_BYTES)
    throw new Error("Native checkpoint exceeds 8 MiB");
  const cursor = schema.parse(input);
  if (cursor.scope !== scope || cursor.checksum !== checksum(cursor))
    throw new Error(
      "Checkpoint integrity or root qualification contract changed",
    );
  if (cursor.phase === "inventory") {
    if (cursor.requests !== 0 || cursor.bytes !== 0)
      throw new Error("Initial checkpoint already contains request effects");
    return cursor;
  }
  if (
    cursor.requests < 1 ||
    cursor.bytes < cursor.requests ||
    cursor.bytes > cursor.requests * CARS4PARTS_MAX_BODY_BYTES
  )
    throw new Error(
      "Checkpoint request and response-byte accounting is inconsistent",
    );
  if (cursor.phase === "complete") return cursor;
  if (
    new Set(cursor.makes).size !== cursor.makes.length ||
    cursor.inventoryHash !== cars4partsHash(cursor.makes)
  )
    throw new Error("Checkpoint native make boundaries changed");
  const graph = cursor.pages[0]?.pages ?? [];
  for (const [index, page] of cursor.pages.entries()) {
    if (
      page.page !== index + 1 ||
      page.pages.some((value, i) => value !== i + 1) ||
      cars4partsHash(page.pages) !== cars4partsHash(graph) ||
      page.hash !== cars4partsHash({ pages: page.pages, rows: page.rows }) ||
      page.rows.some(
        (row) => cars4partsLeafUrl(row.destination) !== row.destination,
      )
    )
      throw new Error(
        "Checkpoint is not a validated contiguous prefix of the literal native result graph",
      );
  }
  if (cursor.phase === "opening") {
    if (
      (cursor.pages.length > 0 && cursor.pages.length >= graph.length) ||
      cursor.requests !== 1 + cursor.pages.length
    )
      throw new Error(
        "Opening checkpoint has already completed or skipped the published result graph",
      );
    return cursor;
  }
  if (!graph.length || cursor.pages.length !== graph.length)
    throw new Error(
      "Native leaf checkpoint lacks complete opening result pages",
    );
  const destinations = cars4partsLeafDestinations(cursor.pages);
  if (
    destinations.length > 1000 ||
    cursor.records.length > destinations.length ||
    cursor.records.some(
      (record, index) => record.destination !== destinations[index],
    )
  )
    throw new Error(
      "Native details are not a finite contiguous prefix of unique published leaf destinations",
    );
  const openingRequests = 1 + cursor.pages.length + cursor.records.length;
  if (cursor.phase === "leaves") {
    if (
      cursor.records.length >= destinations.length ||
      cursor.requests !== openingRequests
    )
      throw new Error(
        "Detail checkpoint has completed or skipped the published leaf graph",
      );
  } else {
    if (
      cursor.records.length !== destinations.length ||
      cursor.requests !== openingRequests + cursor.closed ||
      (cursor.phase === "ready"
        ? cursor.closed !== cursor.pages.length
        : cursor.closed >= cursor.pages.length)
    )
      throw new Error(
        "Closing checkpoint does not match the complete native detail and closing-page prefix",
      );
  }
  return cursor;
}
export const Cars4PartsCursor = {
  initial(contract: Cars4PartsContract): Cars4PartsCursor {
    const parsed = schema.parse({
      source: "cars4parts",
      version: 1,
      phase: "inventory",
      scope: cars4partsHash(Cars4PartsContractSchema.parse(contract)),
      checksum: "0".repeat(64),
      requests: 0,
      bytes: 0,
    });
    return { ...parsed, checksum: checksum(parsed) };
  },
  parse(input: unknown, contract: Cars4PartsContract) {
    return Cars4PartsResult.boundary("durable checkpoint", () =>
      validate(input, contract),
    );
  },
  checkpoint(input: Cars4PartsUnsignedCursor, contract: Cars4PartsContract) {
    return Cars4PartsResult.boundary("durable checkpoint", () => {
      const parsed = schema.parse({ ...input, checksum: "0".repeat(64) });
      return validate({ ...parsed, checksum: checksum(parsed) }, contract);
    });
  },
} as const;
