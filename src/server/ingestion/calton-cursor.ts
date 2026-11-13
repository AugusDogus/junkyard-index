import { z } from "zod";
import {
  CALTON_MAKES,
  CALTON_ROOT,
  CaltonContractSchema,
  caltonBoundary,
  caltonControlUrl,
  caltonHash,
  type CaltonContract,
  type CaltonResult,
} from "./calton-contract";
import { CALTON_MAX_BODY_BYTES } from "./calton-client";
import {
  CaltonContextSchema,
  CaltonControlSchema,
  CaltonRecordSchema,
} from "./calton-record";
import type { CaltonPage } from "./calton-parser";

/** Observed graph: 679 request nodes, 630 model pages and about 12.8k rows.
 * Native WordPress chrome already exceeds 111 MB at 532 captured pages. */
export const CALTON_MAX_REQUESTS = 2048;
export const CALTON_MAX_TOTAL_BYTES = 256 * 1024 * 1024;
export const CALTON_MAX_CURSOR_BYTES = 64 * 1024 * 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const controls = z.array(CaltonControlSchema).min(1).max(1536);
const directory = z
  .object({
    sourceUrl: z.string(),
    controls,
    continuationControls: z.array(z.string()),
    bodyHash: hash,
    bytes: z.number().int().positive().max(CALTON_MAX_BODY_BYTES),
  })
  .strict();
const menu = z.object({ make: CaltonControlSchema, directory }).strict();
export type CaltonMenu = z.infer<typeof menu>;
const count = {
  advertised: z.number().int().nonnegative().safe(),
  observed: z.number().int().nonnegative().safe(),
};
const page = z
  .object({
    sourceUrl: z.string(),
    context: CaltonContextSchema,
    bytes: z.number().int().positive().max(CALTON_MAX_BODY_BYTES),
    bodyHash: hash,
    records: z.array(CaltonRecordSchema).max(50_000),
    continuationControls: z.array(z.string()),
    nativeEmptyResult: z.string().nullable(),
    countCheck: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("unbound") }).strict(),
      z.object({ kind: z.enum(["matches", "mismatch"]), ...count }).strict(),
    ]),
  })
  .strict();
const base = {
  source: z.literal("calton"),
  version: z.literal(1),
  scope: hash,
  checksum: hash,
  requests: z.number().int().min(0).max(CALTON_MAX_REQUESTS),
  bytes: z.number().int().min(0).max(CALTON_MAX_TOTAL_BYTES),
};
const arrivals = { arrivals: page };
const graph = { ...arrivals, makes: directory, menus: z.array(menu).max(256) };
const models = { ...graph, pages: z.array(page).max(1536) };
const schema = z.discriminatedUnion("phase", [
  z.object({ ...base, phase: z.literal("arrivals") }).strict(),
  z.object({ ...base, ...arrivals, phase: z.literal("directory") }).strict(),
  z.object({ ...base, ...graph, phase: z.literal("menus") }).strict(),
  z.object({ ...base, ...models, phase: z.enum(["models", "ready"]) }).strict(),
  z.object({ ...base, phase: z.literal("complete") }).strict(),
]);
export type CaltonCursor = z.infer<typeof schema>;
export const caltonModels = (menus: readonly CaltonMenu[]) =>
  menus.flatMap(({ make, directory }) =>
    directory.controls.map((model) => ({ make, model })),
  );
const checksum = (cursor: CaltonCursor) =>
  caltonHash({ ...cursor, checksum: undefined });

function validatePage(entry: CaltonPage, expected: CaltonPage["context"]) {
  if (
    caltonHash(entry.context) !== caltonHash(expected) ||
    entry.sourceUrl !== expected.sourceUrl ||
    entry.continuationControls.length ||
    entry.records.some(
      (record, index) =>
        record.ordinal !== index ||
        record.sourceUrl !== entry.sourceUrl ||
        caltonHash(record.context) !== caltonHash(expected),
    )
  )
    throw new Error(
      "Checkpoint page has a changed source, parent, record ordinal or unread continuation",
    );
  if (
    entry.records.length === 0
      ? entry.nativeEmptyResult !==
        "No Results.. Try Browsing Our Parts Or Search Again"
      : entry.nativeEmptyResult !== null
  )
    throw new Error(
      "Checkpoint empty-result evidence contradicts its donor rows",
    );
  const expectedCount =
    expected.kind === "arrivals"
      ? { kind: "unbound" }
      : {
          kind:
            entry.records.length === expected.model.count
              ? "matches"
              : "mismatch",
          advertised: expected.model.count,
          observed: entry.records.length,
        };
  if (caltonHash(entry.countCheck) !== caltonHash(expectedCount))
    throw new Error("Checkpoint native count observation changed");
}
function validate(input: unknown, contract: CaltonContract): CaltonCursor {
  const qualification = CaltonContractSchema.parse(contract);
  if (Buffer.byteLength(JSON.stringify(input)) > CALTON_MAX_CURSOR_BYTES)
    throw new Error(
      "Checkpoint exceeds the 64 MiB bound for the native corpus",
    );
  const cursor = schema.parse(input);
  if (
    cursor.scope !== caltonHash(qualification) ||
    cursor.checksum !== checksum(cursor)
  )
    throw new Error(
      "Checkpoint integrity, source or qualification contract changed",
    );
  if (cursor.phase === "complete") {
    if (cursor.requests < 4 || cursor.bytes < cursor.requests)
      throw new Error(
        "Terminal checkpoint has invalid request/byte accounting",
      );
    return cursor;
  }
  let expectedRequests = 0,
    expectedBytes = 0;
  if ("arrivals" in cursor) {
    validatePage(cursor.arrivals, { kind: "arrivals", sourceUrl: CALTON_ROOT });
    expectedRequests++;
    expectedBytes += cursor.arrivals.bytes;
  }
  if ("makes" in cursor) {
    if (
      cursor.makes.sourceUrl !== CALTON_MAKES ||
      cursor.makes.continuationControls.length ||
      cursor.makes.controls.length > 256 ||
      new Set(cursor.makes.controls.map((control) => control.path)).size !==
        cursor.makes.controls.length ||
      cursor.makes.controls.some((control) => !caltonControlUrl(control, 2))
    )
      throw new Error(
        "Checkpoint make graph is foreign, duplicated, oversized or unread",
      );
    expectedRequests++;
    expectedBytes += cursor.makes.bytes;
    if (
      cursor.menus.length > cursor.makes.controls.length ||
      (cursor.phase === "menus"
        ? cursor.menus.length >= cursor.makes.controls.length
        : cursor.menus.length !== cursor.makes.controls.length)
    )
      throw new Error(
        "Checkpoint model menus are not a contiguous complete make prefix",
      );
    cursor.menus.forEach((entry, index) => {
      const make = cursor.makes.controls[index];
      if (
        !make ||
        caltonHash(entry.make) !== caltonHash(make) ||
        entry.directory.sourceUrl !== caltonControlUrl(make, 2) ||
        entry.directory.continuationControls.length ||
        entry.directory.controls.some(
          (model) =>
            !caltonControlUrl(model, 3) ||
            !model.path.startsWith(make.path + "/"),
        )
      )
        throw new Error(
          "Checkpoint menu changed its literal published parent or contains unread controls",
        );
      expectedRequests++;
      expectedBytes += entry.directory.bytes;
    });
    const published = caltonModels(cursor.menus);
    if (
      published.length > 1536 ||
      new Set(published.map(({ model }) => model.path)).size !==
        published.length
    )
      throw new Error("Checkpoint repeats or exceeds the bounded model graph");
    if ("pages" in cursor) {
      if (
        cursor.phase === "ready"
          ? cursor.pages.length !== published.length
          : cursor.pages.length >= published.length
      )
        throw new Error(
          "Checkpoint donor pages are not the required published-model prefix",
        );
      cursor.pages.forEach((entry, index) => {
        const context = published[index];
        const sourceUrl = context ? caltonControlUrl(context.model, 3) : null;
        if (!context || !sourceUrl)
          throw new Error("Checkpoint donor page has no literal model control");
        validatePage(entry, { kind: "model", sourceUrl, ...context });
        expectedRequests++;
        expectedBytes += entry.bytes;
      });
    }
  }
  if (cursor.requests !== expectedRequests || cursor.bytes !== expectedBytes)
    throw new Error(
      "Checkpoint request/byte accounting differs from its validated native prefix",
    );
  return cursor;
}
function checkpoint(input: unknown, contract: CaltonContract): CaltonCursor {
  const unsigned = schema.parse({
    ...z.record(z.string(), z.unknown()).parse(input),
    checksum: "0".repeat(64),
  });
  return validate({ ...unsigned, checksum: checksum(unsigned) }, contract);
}
export const CaltonCursor = {
  initial(contract: CaltonContract): CaltonResult<CaltonCursor> {
    return caltonBoundary("initial checkpoint", () =>
      checkpoint(
        {
          source: "calton",
          version: 1,
          scope: caltonHash(CaltonContractSchema.parse(contract)),
          requests: 0,
          bytes: 0,
          phase: "arrivals",
        },
        contract,
      ),
    );
  },
  parse(input: unknown, contract: CaltonContract) {
    return caltonBoundary("checkpoint", () => validate(input, contract));
  },
  fromWire(raw: string, contract: CaltonContract) {
    return caltonBoundary("checkpoint wire", () => {
      if (Buffer.byteLength(raw) > CALTON_MAX_CURSOR_BYTES)
        throw new Error("Checkpoint wire exceeds 64 MiB");
      return validate(JSON.parse(raw), contract);
    });
  },
  serialize(cursor: CaltonCursor, contract: CaltonContract) {
    return caltonBoundary("checkpoint serialization", () =>
      JSON.stringify(validate(cursor, contract)),
    );
  },
  checkpoint(input: unknown, contract: CaltonContract) {
    return caltonBoundary("checkpoint transition", () =>
      checkpoint(input, contract),
    );
  },
} as const;
