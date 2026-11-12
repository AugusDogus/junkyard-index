import { expect, test } from "bun:test";
import {
  AWAP_MAX_CURSOR_BYTES,
  AWAP_MAX_REQUESTS,
  AwapCursor,
  AwapCursorSchema,
} from "./awap-cursor";
import { parseAwapPage } from "./awap-parser";
import { awapSavedCensus } from "./awap-test-fixtures";
import { AWAP_CATALOG } from "./awap-yard-metadata";

test("AWAP cursor validates scope, integrity, full-count prefixes and serialized bounds", () => {
  const firstBody = awapSavedCensus.pages[0];
  const secondBody = awapSavedCensus.pages[1];
  if (!firstBody || !secondBody) throw new Error("Missing saved pages");
  const first = parseAwapPage(firstBody, AWAP_CATALOG);
  const second = parseAwapPage(secondBody, AWAP_CATALOG + "page/2/");
  const begin = AwapCursor.begin();
  const cursor = AwapCursor.checkpoint({ ...begin, pages: [first] });
  expect(AwapCursor.parse(AwapCursor.serialize(cursor))).toEqual(cursor);
  expect(
    AwapCursorSchema.safeParse({ ...cursor, checksum: "0".repeat(64) }).success,
  ).toBe(false);
  expect(() => AwapCursor.checkpoint({ ...cursor, pages: [second] })).toThrow(
    "begin",
  );
  expect(() =>
    AwapCursor.checkpoint({ ...cursor, pages: [first, first] }),
  ).toThrow("pages");
  expect(() =>
    AwapCursor.checkpoint({ ...cursor, phase: "closing", closing: 0 }),
  ).toThrow("complete native census");
  expect(() =>
    AwapCursor.checkpoint({ ...cursor, scope: "0".repeat(64) }),
  ).toThrow();
  expect(() => AwapCursor.parse(" ".repeat(AWAP_MAX_CURSOR_BYTES + 1))).toThrow(
    "wire payload",
  );
  expect(() =>
    AwapCursor.parse(
      '{"source":"awap","version":1,"phase":"identity","unexpected":true}',
    ),
  ).toThrow();
  expect(AWAP_MAX_REQUESTS).toBe(65);
});
