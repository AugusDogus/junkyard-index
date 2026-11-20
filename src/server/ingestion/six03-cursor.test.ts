import { expect, test } from "bun:test";
import {
  Six03Cursor,
  Six03CursorSchema,
  SIX03_MAX_CURSOR_BYTES,
} from "./six03-cursor";
import {
  parseSix03Catalog,
  parseSix03Contact,
  parseSix03RestPage,
} from "./six03-parser";
import { six03NativeFixtures, six03RestFixtures } from "./six03-test-fixtures";

const fixtures = six03NativeFixtures();
const catalog = parseSix03Catalog(fixtures.catalog);
const rest = six03RestFixtures().pages;
const [first, second] = [0, 1].map((index) => {
  const page = rest[index];
  if (!page) throw new Error("Missing saved REST page");
  return parseSix03RestPage(page.body, index + 1, page, catalog);
});
if (!first || !second) throw new Error("Missing parsed REST pages");
const state = Six03Cursor.checkpoint({
  ...Six03Cursor.initial,
  phase: "donors",
  contact: parseSix03Contact(fixtures.contact),
  catalog,
  pages: [first.ids, second.ids],
  details: [...first.details, ...second.details],
  requests: 4,
});

test("603 checkpoint round trips exact REST projections with strict source, version, scope and unknown-field rejection", () => {
  expect(Six03Cursor.parse(Six03Cursor.serialize(state))).toEqual(state);
  for (const altered of [
    { ...state, source: "other" },
    { ...state, version: 1 },
    { ...state, scope: "0".repeat(64) },
    { ...state, unexpected: "field" },
    { ...state, checksum: "0".repeat(64) },
  ])
    expect(Six03CursorSchema.safeParse(altered).success).toBe(false);
  expect(() =>
    Six03Cursor.parse(" ".repeat(SIX03_MAX_CURSOR_BYTES + 1)),
  ).toThrow("1 MiB");
  expect(() => Six03Cursor.parse("{broken")).toThrow();
});

test("603 checkpoint refuses reordered, short, repeated and unlisted REST donor pages", () => {
  const prefix = "descending-id prefix";
  // Pages out of order break descending ids.
  expect(() =>
    Six03Cursor.checkpoint({
      ...state,
      pages: [second.ids, first.ids],
      details: [...second.details, ...first.details],
    }),
  ).toThrow(prefix);
  // A short page that is not the last one.
  expect(() =>
    Six03Cursor.checkpoint({
      ...state,
      pages: [first.ids.slice(1), second.ids],
      details: [...first.details.slice(1), ...second.details],
    }),
  ).toThrow(prefix);
  // The same donor twice.
  const repeated = first.details[0];
  if (!repeated) throw new Error("Missing REST donor");
  expect(() =>
    Six03Cursor.checkpoint({
      ...state,
      details: [repeated, ...first.details.slice(0, -1), ...second.details],
    }),
  ).toThrow(prefix);
  // A donor the catalog does not list.
  expect(() =>
    Six03Cursor.checkpoint({
      ...state,
      catalog: {
        ...catalog,
        posts: catalog.posts.filter(([path]) => path !== repeated.path),
      },
    }),
  ).toThrow();
  expect(() => Six03Cursor.checkpoint({ ...state, requests: 5 })).toThrow(
    "request accounting",
  );
  expect(() => Six03Cursor.checkpoint({ ...state, phase: "closing" })).toThrow(
    prefix,
  );
  expect(() =>
    Six03Cursor.checkpoint({ ...state, closing: 1, requests: 5 }),
  ).toThrow(prefix);
});

test("603 checkpoint refuses retained field and catalog corruption even before roster checks", () => {
  const record = first.details[0];
  if (!record) throw new Error("Missing REST donor");
  expect(() =>
    Six03Cursor.checkpoint({
      ...state,
      details: [
        { ...record, image: "https://example.com/poison.jpg" },
        ...state.details.slice(1),
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
