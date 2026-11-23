import { expect, test } from "bun:test";
import { ModelCensus } from "./model-census";
import {
  Six03Cursor,
  Six03CursorSchema,
  SIX03_MAX_CURSOR_BYTES,
} from "./six03-cursor";
import {
  parseSix03Catalog,
  parseSix03Contact,
  parseSix03Detail,
} from "./six03-parser";
import { six03PendingPosts } from "./six03-snapshot";
import { six03FixtureDetail, six03NativeFixtures } from "./six03-test-fixtures";

const fixtures = six03NativeFixtures();
const catalog = parseSix03Catalog(fixtures.catalog);
const posts = six03PendingPosts(catalog);
const first = posts[0];
const second = posts[1];
if (!first || !second)
  throw new Error("Missing native cursor boundary fixtures");
const records = [first, second].map((post) =>
  parseSix03Detail(six03FixtureDetail(post[0]), post),
);
const state = Six03Cursor.checkpoint({
  ...Six03Cursor.initial,
  phase: "details",
  contact: parseSix03Contact(fixtures.contact),
  catalog,
  details: records,
  requests: 4,
  day: ModelCensus.day(Date.parse("2026-11-22")),
});

test("603 checkpoint round trips exact native projections with strict source, version, scope and unknown-field rejection", () => {
  expect(Six03Cursor.parse(Six03Cursor.serialize(state))).toEqual(state);
  for (const altered of [
    { ...state, source: "other" },
    { ...state, version: 2 },
    { ...state, scope: "0".repeat(64) },
    { ...state, unexpected: "field" },
    { ...state, checksum: "0".repeat(64) },
  ])
    expect(Six03CursorSchema.safeParse(altered).success).toBe(false);
  expect(() =>
    Six03Cursor.parse(" ".repeat(SIX03_MAX_CURSOR_BYTES + 1)),
  ).toThrow("4 MiB");
  expect(() => Six03Cursor.parse("{broken")).toThrow();
});

test("603 checkpoint refuses reordered, skipped, duplicated and unlisted native donor membership", () => {
  const firstRecord = records[0];
  const secondRecord = records[1];
  if (!firstRecord || !secondRecord)
    throw new Error("Missing retained native details");
  for (const details of [
    [secondRecord, firstRecord],
    [secondRecord],
    [firstRecord, firstRecord],
  ])
    expect(() =>
      Six03Cursor.checkpoint({
        ...state,
        details,
        requests: details.length + 2,
      }),
    ).toThrow("membership prefix");
  expect(() => Six03Cursor.checkpoint({ ...state, requests: 5 })).toThrow(
    "request accounting",
  );
  expect(() => Six03Cursor.checkpoint({ ...state, phase: "closing" })).toThrow(
    "membership prefix",
  );
  expect(() =>
    Six03Cursor.checkpoint({ ...state, closing: 1, requests: 5 }),
  ).toThrow("membership prefix");
});

test("603 checkpoint refuses retained field and catalog corruption even before native membership checks", () => {
  const firstRecord = records[0];
  if (!firstRecord) throw new Error("Missing native detail");
  expect(() =>
    Six03Cursor.checkpoint({
      ...state,
      details: [
        { ...firstRecord, image: "https://example.com/poison.jpg" },
        ...records.slice(1),
      ],
    }),
  ).toThrow("projection");
  expect(() =>
    Six03Cursor.checkpoint({
      ...state,
      catalog: { ...catalog, posts: [...catalog.posts].reverse() },
    }),
  ).toThrow("projection");
  expect(() => Six03Cursor.checkpoint({ ...state, phase: "catalog" })).toThrow(
    "phase",
  );
});
