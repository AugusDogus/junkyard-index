import { z } from "zod";
import { AlliedContractSchema, type AlliedContract } from "./allied-contract";
import { alliedBrowsePath } from "./allied-html";
import { alliedHash } from "./allied-parser";
import {
  AlliedContextSchema,
  AlliedControlSchema,
  AlliedRecordSchema,
} from "./allied-record";
import { AlliedResult } from "./allied-result";
import { alliedModels } from "./allied-snapshot";

export const ALLIED_MAX_CURSOR_BYTES = 8 * 1024 * 1024;
export const ALLIED_MAX_REQUESTS = 1024;
export const ALLIED_MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const base = {
  source: z.literal("allied"),
  version: z.literal(1),
  scope: hash,
  checksum: hash,
  requests: z.number().int().min(0).max(ALLIED_MAX_REQUESTS),
  bytes: z.number().int().min(0).max(ALLIED_MAX_TOTAL_BYTES),
};
const page = z
  .object({
    context: AlliedContextSchema,
    records: z.array(AlliedRecordSchema).max(499),
    hash,
    nativeEmpty: z.boolean(),
  })
  .strict();
const owner = { ownerHash: hash };
const arrivals = { ...owner, arrivals: page };
const makes = {
  ...arrivals,
  makes: z.array(AlliedControlSchema).min(1).max(1024),
};
const graph = {
  ...makes,
  menus: z
    .array(
      z
        .object({
          make: AlliedControlSchema,
          models: z.array(AlliedControlSchema).max(1024),
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
  z
    .object({
      ...base,
      ...modelPages,
      phase: z.literal("closing"),
      closingIndex: z.number().int().min(0).max(1025),
    })
    .strict(),
  z.object({ ...base, ...modelPages, phase: z.literal("ready") }).strict(),
  z.object({ ...base, phase: z.literal("complete") }).strict(),
]);
export type AlliedCursor = z.infer<typeof schema>;
type UnsignedCursor<Cursor = AlliedCursor> = Cursor extends { checksum: string }
  ? Omit<Cursor, "checksum">
  : never;
const checksum = (cursor: AlliedCursor | UnsignedCursor) => {
  return alliedHash({ ...cursor, checksum: undefined });
};

function validate(input: unknown, contract: AlliedContract): AlliedCursor {
  AlliedContractSchema.parse(contract);
  if (Buffer.byteLength(JSON.stringify(input)) > ALLIED_MAX_CURSOR_BYTES)
    throw new Error("Native checkpoint exceeds 8 MiB");
  const cursor = schema.parse(input);
  if (
    cursor.scope !== alliedHash(contract) ||
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
            : cursor.phase === "models" ||
                cursor.phase === "closing" ||
                cursor.phase === "ready"
              ? 3 +
                cursor.makes.length +
                cursor.pages.length +
                (cursor.phase === "closing"
                  ? cursor.closingIndex
                  : cursor.phase === "ready"
                    ? cursor.makes.length + 2
                    : 0)
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
      cursor.arrivals.hash !== alliedHash(cursor.arrivals.records))
  )
    throw new Error("Checkpoint arrival evidence is invalid");
  if (!("makes" in cursor)) return cursor;
  if (
    new Set(cursor.makes.map((make) => make.path)).size !== cursor.makes.length
  )
    throw new Error("Checkpoint repeats a published make destination");
  for (const make of cursor.makes)
    if (alliedBrowsePath(make.path, 1) !== make.path)
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
    if (alliedHash(menu.make) !== alliedHash(cursor.makes[index]))
      throw new Error(
        "Checkpoint model directory changed its published make parent",
      );
    for (const model of menu.models)
      if (
        alliedBrowsePath(model.path, 2) !== model.path ||
        !model.path.startsWith(menu.make.path.replace(/\/$/, "") + "/")
      )
        throw new Error(
          "Checkpoint model control is unowned or crosses its literal make parent",
        );
  });
  const models = alliedModels(cursor.menus);
  if (new Set(models.map((entry) => entry.model.path)).size !== models.length)
    throw new Error("Checkpoint repeats a published model destination");
  if (!("pages" in cursor)) return cursor;
  if (
    cursor.phase === "ready" || cursor.phase === "closing"
      ? cursor.pages.length !== models.length
      : cursor.pages.length >= models.length
  )
    throw new Error(
      "Checkpoint donor pages are not a contiguous published-model prefix",
    );
  if (
    cursor.phase === "closing" &&
    cursor.closingIndex >= cursor.makes.length + 2
  )
    throw new Error(
      "Allied closing checkpoint exceeds its native directory frontier",
    );
  cursor.pages.forEach((entry, index) => {
    const expected = models[index];
    if (
      !expected ||
      entry.context.kind !== "model" ||
      alliedHash({ make: entry.context.make, model: entry.context.model }) !==
        alliedHash(expected) ||
      entry.hash !== alliedHash(entry.records) ||
      entry.nativeEmpty !== (entry.records.length === 0)
    )
      throw new Error(
        "Checkpoint model evidence, literal context or fingerprint changed",
      );
  });
  return cursor;
}
export const AlliedCursor = {
  initial(contract: AlliedContract): AlliedCursor {
    const value: UnsignedCursor = {
      source: "allied",
      version: 1,
      scope: alliedHash(contract),
      phase: "owner",
      requests: 0,
      bytes: 0,
    };
    const canonical = schema.parse({ ...value, checksum: "0".repeat(64) });
    return { ...canonical, checksum: checksum(canonical) };
  },
  parse(input: unknown, contract: AlliedContract) {
    return AlliedResult.boundary("checkpoint", () => validate(input, contract));
  },
  fromWire(raw: string, contract: AlliedContract) {
    return AlliedResult.boundary("checkpoint wire", () => {
      if (Buffer.byteLength(raw) > ALLIED_MAX_CURSOR_BYTES)
        throw new Error("Native checkpoint wire payload exceeds 8 MiB");
      return validate(JSON.parse(raw), contract);
    });
  },
  serialize(cursor: AlliedCursor, contract: AlliedContract) {
    return AlliedResult.boundary("checkpoint serialization", () =>
      JSON.stringify(validate(cursor, contract)),
    );
  },
  checkpoint(state: UnsignedCursor, contract: AlliedContract) {
    return AlliedResult.boundary("checkpoint transition", () => {
      const canonical = schema.parse({ ...state, checksum: "0".repeat(64) });
      return validate(
        { ...canonical, checksum: checksum(canonical) },
        contract,
      );
    });
  },
} as const;
