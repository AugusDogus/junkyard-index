import { expect, test } from "bun:test";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-cursor";
import {
  PickapartvaCursor,
  PickapartvaCursorSchema,
} from "./pickapartva-cursor";
import { pickapartvaCardKey, pickapartvaHash } from "./pickapartva-parser";
import { pickapartvaTestRecord } from "./pickapartva-test-fixtures";
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
    searches: [],
    recoveries: [],
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

const date = "2026-11-16";
const shown = { ...pickapartvaTestRecord, setDate: date };
const ford = { ...shown, cardId: "PAP100001", stock: "PAP100001" };
const href = (id: string, make = "ANY") =>
  `https://pickapartva.com/inventory/${make.replaceAll(" ", "_")}/ANY/?k=1&id=${id}&search=${date}`;
/** A Fredericksburg yard search capped, Stafford empty, and the FORD search
 * that found the one donor the catalog hid. */
const recovery = {
  date,
  slots: 1,
  shown: [pickapartvaCardKey(shown)],
  startedAt: 1_795_000_000_000,
  searches: [
    {
      id: "TT87",
      make: "ANY",
      url: href("TT87"),
      hash: "a".repeat(64),
      capped: true,
    },
    {
      id: "UU81",
      make: "ANY",
      url: href("UU81"),
      hash: "b".repeat(64),
      capped: false,
    },
    {
      id: "TT87",
      make: "FORD",
      url: href("TT87", "FORD"),
      hash: "c".repeat(64),
      capped: false,
    },
  ],
  hidden: [{ id: "TT87", make: "FORD", record: ford }],
  pending: [],
};
const searching = {
  source: "pickapartva",
  phase: "searches",
  recoveries: [
    {
      ...recovery,
      searches: recovery.searches.slice(0, 2),
      hidden: [],
      pending: [
        { id: "TT87", make: "FORD" },
        { id: "TT87", make: "LAND ROVER" },
      ],
    },
  ],
};

test("Pick-A-Part VA set-date recovery checkpoints round-trip the real durable codec", () => {
  for (const value of [searching, { ...searching, recoveries: [recovery] }]) {
    const cursor = PickapartvaCursorSchema.parse(value);
    expect(
      parseDurableSourceCursor(
        "pickapartva",
        serializeDurableSourceCursor(cursor),
      ),
    ).toEqual(cursor);
  }
});

test.each([
  { recoveries: [] },
  { recoveries: [recovery, recovery] },
  { recoveries: [{ ...recovery, date: "2026-11-31" }] },
  { recoveries: [{ ...recovery, startedAt: 0 }] },
  { recoveries: [{ ...recovery, startedAt: 1.5 }] },
  // Resolved without its hidden donor, or holding more than it hid.
  { recoveries: [{ ...recovery, hidden: [] }] },
  { recoveries: [{ ...recovery, slots: 2 }] },
  // Still searching after every hidden donor was found.
  {
    recoveries: [
      { ...recovery, pending: [{ id: "TT87", make: "LAND ROVER" }] },
    ],
  },
  // A hidden donor the catalog showed, set on another date, from another
  // yard or make than its search, or from no search at all.
  {
    recoveries: [
      { ...recovery, hidden: [{ id: "TT87", make: "FORD", record: shown }] },
    ],
  },
  {
    recoveries: [
      {
        ...recovery,
        hidden: [
          {
            id: "TT87",
            make: "FORD",
            record: { ...ford, setDate: "2026-11-15" },
          },
        ],
      },
    ],
  },
  {
    recoveries: [
      {
        ...recovery,
        hidden: [
          { id: "TT87", make: "FORD", record: { ...ford, yardCode: "UU81" } },
        ],
      },
    ],
  },
  {
    recoveries: [
      {
        ...recovery,
        hidden: [
          { id: "TT87", make: "FORD", record: { ...ford, make: "LAND ROVER" } },
        ],
      },
    ],
  },
  {
    recoveries: [
      { ...recovery, hidden: [{ id: "UU81", make: "FORD", record: ford }] },
    ],
  },
  // A search whose URL is not its date, yard and make, a make search across
  // every yard, an unverified make, or a repeated search.
  {
    recoveries: [
      {
        ...recovery,
        searches: recovery.searches.map((search) => ({
          ...search,
          url: search.url.replace("id=", "id=X"),
        })),
      },
    ],
  },
  {
    recoveries: [
      {
        ...recovery,
        searches: [
          ...recovery.searches,
          {
            id: "ANY",
            make: "FORD",
            url: href("ANY", "FORD"),
            hash: "d".repeat(64),
            capped: false,
          },
        ],
      },
    ],
  },
  {
    recoveries: [
      {
        ...searching.recoveries[0],
        pending: [{ id: "TT87", make: "Land Rover" }],
      },
    ],
  },
  {
    recoveries: [
      {
        ...searching.recoveries[0],
        pending: [{ id: "TT87", make: "ANY" }],
      },
    ],
  },
  { recoveries: [{ ...recovery, shown: ["b", "a"] }] },
])(
  "Pick-A-Part VA rejects inconsistent set-date recovery checkpoints (%#)",
  (change) => {
    expect(
      PickapartvaCursorSchema.safeParse({ ...searching, ...change }).success,
    ).toBe(false);
  },
);
