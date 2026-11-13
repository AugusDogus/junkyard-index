import { z } from "zod";
import { RmmdtpContractSchema, type RmmdtpContract } from "./rmmdtp-contract";
import {
  RMMDTP_INVENTORY,
  RMMDTP_MAX_BODY_BYTES,
  rmmdtpDetailUrl,
  rmmdtpPageUrl,
} from "./rmmdtp-html";
import {
  RmmdtpPageSchema,
  rmmdtpHash,
  rmmdtpPageHash,
  type RmmdtpPage,
} from "./rmmdtp-parser";
import { RmmdtpResult } from "./rmmdtp-result";

export const RMMDTP_MAX_REQUESTS = 800;
export const RMMDTP_MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const base = {
  source: z.literal("rmmdtp"),
  version: z.literal(1),
  scope: hash,
  checksum: hash,
  requests: z.number().int().min(0).max(RMMDTP_MAX_REQUESTS),
  bytes: z.number().int().min(0).max(RMMDTP_MAX_TOTAL_BYTES),
  pages: z.array(RmmdtpPageSchema).max(400),
};
const closed = z
  .array(
    z
      .object({
        hash,
        bodyBytes: z.number().int().positive().max(RMMDTP_MAX_BODY_BYTES),
      })
      .strict(),
  )
  .max(400);
const schema = z.discriminatedUnion("phase", [
  z.object({ ...base, phase: z.literal("opening") }).strict(),
  z.object({ ...base, phase: z.literal("closing"), closed }).strict(),
  z.object({ ...base, phase: z.literal("ready"), closed }).strict(),
  z.object({ ...base, phase: z.literal("complete"), closed }).strict(),
]);
export type RmmdtpCursor = z.infer<typeof schema>;
export type RmmdtpUnsignedCursor<Cursor = RmmdtpCursor> = Cursor extends {
  checksum: string;
}
  ? Omit<Cursor, "checksum">
  : never;
const checksum = (cursor: RmmdtpCursor) =>
  rmmdtpHash({ ...cursor, checksum: undefined });
export const rmmdtpGraphUrl = (
  pages: readonly RmmdtpPage[],
  index: number,
): string => {
  const url = index === 0 ? RMMDTP_INVENTORY : pages[index - 1]?.nextUrl;
  if (!url || rmmdtpPageUrl(url, index + 1) !== url)
    throw new Error("Native graph prefix lost its published next destination");
  return url;
};
function validate(input: unknown, contract: RmmdtpContract): RmmdtpCursor {
  if (Buffer.byteLength(JSON.stringify(input)) > 8 * 1024 * 1024)
    throw new Error("Native checkpoint exceeds 8 MiB");
  const cursor = schema.parse(input);
  if (
    cursor.scope !== rmmdtpHash(RmmdtpContractSchema.parse(contract)) ||
    cursor.checksum !== checksum(cursor)
  )
    throw new Error("Checkpoint integrity or qualification contract changed");
  const closing = cursor.phase === "opening" ? [] : cursor.closed;
  if (
    cursor.requests !== cursor.pages.length + closing.length ||
    cursor.bytes !==
      cursor.pages.reduce((total, page) => total + page.bodyBytes, 0) +
        closing.reduce((total, page) => total + page.bodyBytes, 0)
  )
    throw new Error(
      "Checkpoint request and byte accounting contradict its native graph",
    );
  const first = cursor.pages[0];
  for (const [index, page] of cursor.pages.entries()) {
    if (
      !first ||
      page.page !== index + 1 ||
      page.total !== first.total ||
      page.salvageTotal !== first.salvageTotal ||
      page.completeTotal !== first.completeTotal ||
      page.lastPage !== Math.ceil(first.total / 25) ||
      page.total !== page.salvageTotal + page.completeTotal ||
      page.page > page.lastPage ||
      page.records.length !== Math.min(25, page.total - index * 25) ||
      page.hash !== rmmdtpPageHash(page)
    )
      throw new Error(
        "Checkpoint page census, ordering or semantic hash changed",
      );
    const nextPage = index + 2;
    if (
      page.page < page.lastPage
        ? page.nextUrl === null ||
          rmmdtpPageUrl(page.nextUrl, nextPage) !== page.nextUrl
        : page.nextUrl !== null
    )
      throw new Error("Checkpoint lost its observed terminal pagination");
    rmmdtpGraphUrl(cursor.pages, index);
    for (const record of page.records) {
      if (
        rmmdtpDetailUrl(record.detailsUrl) !== record.detailsUrl ||
        new URL(record.detailsUrl).searchParams.get("truck") !== record.id ||
        record.detailAnchors.some((url) => url !== record.detailsUrl) ||
        !["Salvage", "Complete"].includes(record.fields.Condition ?? "")
      )
        throw new Error(
          "Checkpoint donor links or native condition left the qualified scope",
        );
    }
  }
  const finished =
    first !== undefined && cursor.pages.length === first.lastPage;
  if (cursor.phase === "opening") {
    if (finished)
      throw new Error("Opening checkpoint already contains a terminal graph");
  } else {
    if (
      !finished ||
      closing.length > cursor.pages.length ||
      (cursor.phase === "closing"
        ? closing.length >= cursor.pages.length
        : closing.length !== cursor.pages.length)
    )
      throw new Error(
        "Checkpoint phase contradicts its closing verification prefix",
      );
    const records = cursor.pages.flatMap((page) => page.records);
    if (
      records.length !== first.total ||
      records.filter((record) => record.fields.Condition === "Salvage")
        .length !== first.salvageTotal ||
      records.filter((record) => record.fields.Condition === "Complete")
        .length !== first.completeTotal
    )
      throw new Error(
        "Complete native graph does not reconcile its condition census",
      );
    for (const [index, page] of closing.entries())
      if (page.hash !== cursor.pages[index]?.hash)
        throw new Error(
          "Checkpoint closing evidence differs from its opening graph",
        );
  }
  return cursor;
}
export const RmmdtpCursor = {
  schema,
  initial(contract: RmmdtpContract): RmmdtpCursor {
    const unsigned: RmmdtpUnsignedCursor = {
      source: "rmmdtp",
      version: 1,
      scope: rmmdtpHash(RmmdtpContractSchema.parse(contract)),
      requests: 0,
      bytes: 0,
      pages: [],
      phase: "opening",
    };
    return {
      ...unsigned,
      checksum: rmmdtpHash({ ...unsigned, checksum: undefined }),
    };
  },
  parse: (input: unknown, contract: RmmdtpContract) =>
    RmmdtpResult.boundary("resume checkpoint", () => validate(input, contract)),
  checkpoint(input: RmmdtpUnsignedCursor, contract: RmmdtpContract) {
    return RmmdtpResult.boundary("checkpoint", () => {
      const parsed = schema.parse({ ...input, checksum: "0".repeat(64) });
      return validate({ ...parsed, checksum: checksum(parsed) }, contract);
    });
  },
} as const;
