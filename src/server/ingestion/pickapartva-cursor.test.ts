import { expect, test } from "bun:test";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-cursor";
import {
  PickapartvaCursor,
  PickapartvaCursorSchema,
} from "./pickapartva-cursor";
import { pickapartvaHash } from "./pickapartva-parser";
import { PICKAPARTVA_CATALOG } from "./pickapartva-yard-metadata";

const receipts = [1, 2].map((page) => ({
  page,
  url: PICKAPARTVA_CATALOG.replace("pagenum=1", "pagenum=" + page),
  hash: String(page).repeat(64),
}));
const checkpoint = () =>
  PickapartvaCursorSchema.parse({
    source: "pickapartva",
    phase: "pages",
    snapshotHash: pickapartvaHash(
      receipts.map((receipt) => [receipt.page, receipt.url, receipt.hash]),
    ),
    receipts,
    lastPage: 2,
    nextPage: 2,
    processed: 500,
    emitted: 499,
    rejected: 1,
    duplicates: 0,
  });

test("Pick-A-Part VA paused/initial/terminal cursors round-trip the real durable codec", () => {
  for (const cursor of [
    PickapartvaCursor.initial,
    checkpoint(),
    PickapartvaCursorSchema.parse({ source: "pickapartva", phase: "complete" }),
  ]) {
    expect(
      parseDurableSourceCursor(
        "pickapartva",
        serializeDurableSourceCursor(cursor),
      ),
    ).toEqual(cursor);
  }
});

test.each([
  { source: "other" },
  { snapshotHash: "0".repeat(64) },
  { nextPage: 3 },
  { processed: 499 },
  { emitted: 498 },
  { rejected: -1 },
  { extra: true },
  { receipts: receipts.slice(1) },
  {
    receipts: receipts.map((receipt) => ({
      ...receipt,
      url: receipt.url.replace("id=ANY", "id=TT87"),
    })),
  },
])(
  "Pick-A-Part VA rejects foreign/corrupt/inconsistent checkpoints (%#)",
  (change) => {
    expect(
      PickapartvaCursorSchema.safeParse({ ...checkpoint(), ...change }).success,
    ).toBe(false);
  },
);
