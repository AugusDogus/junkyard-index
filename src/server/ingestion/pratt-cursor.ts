import { z } from "zod";
import { PrattContractSchema, type PrattContract } from "./pratt-contract";
import { prattBrowsePath } from "./pratt-html";
import { prattHash } from "./pratt-parser";
import {
  PrattContextSchema,
  PrattControlSchema,
  PrattRecordSchema,
} from "./pratt-record";
import { PrattResult } from "./pratt-result";
import { prattModels } from "./pratt-snapshot";

export const PRATT_MAX_CURSOR_BYTES = 8 * 1024 * 1024;
export const PRATT_MAX_REQUESTS = 1024;
export const PRATT_MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const base = {
  source: z.literal("pratt"),
  version: z.literal(1),
  scope: hash,
  checksum: hash,
  requests: z.number().int().min(0).max(PRATT_MAX_REQUESTS),
  bytes: z.number().int().min(0).max(PRATT_MAX_TOTAL_BYTES),
};
const page = z
  .object({
    context: PrattContextSchema,
    records: z.array(PrattRecordSchema).max(499),
    hash,
    nativeEmpty: z.boolean(),
  })
  .strict();
const owner = { ownerHash: hash };
const arrivals = { ...owner, arrivals: page };
const makes = {
  ...arrivals,
  makes: z.array(PrattControlSchema).min(1).max(1024),
};
const graph = {
  ...makes,
  menus: z
    .array(
      z
        .object({
          make: PrattControlSchema,
          models: z.array(PrattControlSchema).max(1024),
        })
        .strict(),
    )
    .max(1024),
};
const modelPages = { ...graph, pages: z.array(page).max(4096) };
const schema = z.discriminatedUnion("phase", [
  z.object({ ...base, phase: z.literal("owner") }).strict(),
  z.object({ ...base, ...owner, phase: z.literal("arrivals") }).strict(),
  z.object({ ...base, ...arrivals, phase: z.literal("directory") }).strict(),
  z.object({ ...base, ...graph, phase: z.literal("makes") }).strict(),
  z.object({ ...base, ...modelPages, phase: z.literal("models") }).strict(),
  z.object({ ...base, ...modelPages, phase: z.literal("ready") }).strict(),
  z.object({ ...base, phase: z.literal("complete") }).strict(),
]);
export type PrattCursor = z.infer<typeof schema>;
type UnsignedCursor<Cursor = PrattCursor> = Cursor extends { checksum: string }
  ? Omit<Cursor, "checksum">
  : never;
const checksum = (cursor: PrattCursor | UnsignedCursor) => {
  return prattHash({ ...cursor, checksum: undefined });
};

function validate(input: unknown, contract: PrattContract): PrattCursor {
  PrattContractSchema.parse(contract);
  if (Buffer.byteLength(JSON.stringify(input)) > PRATT_MAX_CURSOR_BYTES)
    throw new Error("Native checkpoint exceeds 8 MiB");
  const cursor = schema.parse(input);
  if (
    cursor.scope !== prattHash(contract) ||
    cursor.checksum !== checksum(cursor)
  )
    throw new Error(
      "Checkpoint integrity or root qualification contract changed",
    );
  const expectedRequests =
    cursor.phase === "owner"
      ? 0
      : cursor.phase === "arrivals"
        ? 1
        : cursor.phase === "directory"
          ? 2
          : cursor.phase === "makes"
            ? 3 + cursor.menus.length
            : cursor.phase === "models" || cursor.phase === "ready"
              ? 3 + cursor.makes.length + cursor.pages.length
              : cursor.requests;
  if (
    cursor.requests !== expectedRequests ||
    (cursor.phase === "owner"
      ? cursor.bytes !== 0
      : cursor.bytes < cursor.requests)
  )
    throw new Error(
      "Checkpoint request/byte accounting is inconsistent with its native control prefix",
    );
  if (
    "arrivals" in cursor &&
    (cursor.arrivals.context.kind !== "arrivals" ||
      cursor.arrivals.hash !== prattHash(cursor.arrivals.records))
  )
    throw new Error("Checkpoint arrival evidence is invalid");
  if (!("makes" in cursor)) return cursor;
  if (
    new Set(cursor.makes.map((make) => make.path)).size !== cursor.makes.length
  )
    throw new Error("Checkpoint repeats a published make destination");
  for (const make of cursor.makes)
    if (prattBrowsePath(make.path, 1) !== make.path)
      throw new Error("Checkpoint contains an unowned make destination");
  if (
    cursor.menus.length > cursor.makes.length ||
    (cursor.phase === "makes"
      ? cursor.menus.length >= cursor.makes.length
      : cursor.menus.length !== cursor.makes.length)
  )
    throw new Error(
      "Checkpoint model directories are not a complete contiguous make prefix",
    );
  cursor.menus.forEach((menu, index) => {
    if (prattHash(menu.make) !== prattHash(cursor.makes[index]))
      throw new Error(
        "Checkpoint model directory changed its published make parent",
      );
    for (const model of menu.models)
      if (
        prattBrowsePath(model.path, 2) !== model.path ||
        !model.path.startsWith(menu.make.path.replace(/\/$/, "") + "/")
      )
        throw new Error(
          "Checkpoint model control is unowned or crosses its literal make parent",
        );
  });
  const models = prattModels(cursor.menus);
  if (new Set(models.map((entry) => entry.model.path)).size !== models.length)
    throw new Error("Checkpoint repeats a published model destination");
  if (!("pages" in cursor)) return cursor;
  if (
    cursor.phase === "ready"
      ? cursor.pages.length !== models.length
      : cursor.pages.length >= models.length
  )
    throw new Error(
      "Checkpoint donor pages are not a contiguous published-model prefix",
    );
  cursor.pages.forEach((entry, index) => {
    const expected = models[index];
    if (
      !expected ||
      entry.context.kind !== "model" ||
      prattHash({ make: entry.context.make, model: entry.context.model }) !==
        prattHash(expected) ||
      entry.hash !== prattHash(entry.records) ||
      entry.nativeEmpty !== (entry.records.length === 0)
    )
      throw new Error(
        "Checkpoint model evidence, literal context or fingerprint changed",
      );
  });
  return cursor;
}
export const PrattCursor = {
  initial(contract: PrattContract): PrattCursor {
    const value: UnsignedCursor = {
      source: "pratt",
      version: 1,
      scope: prattHash(contract),
      phase: "owner",
      requests: 0,
      bytes: 0,
    };
    const canonical = schema.parse({ ...value, checksum: "0".repeat(64) });
    return { ...canonical, checksum: checksum(canonical) };
  },
  parse(input: unknown, contract: PrattContract) {
    return PrattResult.boundary("checkpoint", () => validate(input, contract));
  },
  fromWire(raw: string, contract: PrattContract) {
    return PrattResult.boundary("checkpoint wire", () => {
      if (Buffer.byteLength(raw) > PRATT_MAX_CURSOR_BYTES)
        throw new Error("Native checkpoint wire payload exceeds 8 MiB");
      return validate(JSON.parse(raw), contract);
    });
  },
  serialize(cursor: PrattCursor, contract: PrattContract) {
    return PrattResult.boundary("checkpoint serialization", () =>
      JSON.stringify(validate(cursor, contract)),
    );
  },
  checkpoint(state: UnsignedCursor, contract: PrattContract) {
    return PrattResult.boundary("checkpoint transition", () => {
      const canonical = schema.parse({ ...state, checksum: "0".repeat(64) });
      return validate(
        { ...canonical, checksum: checksum(canonical) },
        contract,
      );
    });
  },
} as const;
