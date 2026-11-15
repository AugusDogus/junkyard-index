import { expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import { PickersCursor, PICKERS_MAX_CURSOR_BYTES } from "./pickers-cursor";
import { PickersCoverageCursor } from "./pickers-coverage-cursor";

test("coverage checkpoints preserve legacy single-yard and new yard traversal shapes", () => {
  expect(
    PickersCoverageCursor.parse(PickersCursor.serialize(PickersCursor.initial)),
  ).toEqual(PickersCursor.initial);
  expect(
    PickersCoverageCursor.parse(
      PickersCoverageCursor.serialize(PickersCoverageCursor.initial),
    ),
  ).toEqual(PickersCoverageCursor.initial);
  expect(() =>
    PickersCoverageCursor.parse(" ".repeat(PICKERS_MAX_CURSOR_BYTES + 1)),
  ).toThrow("1 MiB");
});

test("compressed Pickers input has a bounded decoded size and still requires a validated cursor", () => {
  const compressed = (raw: string) =>
    JSON.stringify({
      encoding: "gzip-base64",
      data: gzipSync(raw).toString("base64"),
    });
  expect(
    PickersCursor.parse(
      compressed(PickersCursor.serialize(PickersCursor.initial)),
    ),
  ).toEqual(PickersCursor.initial);
  expect(() =>
    PickersCursor.parse(
      compressed(" ".repeat(4 * PICKERS_MAX_CURSOR_BYTES + 1)),
    ),
  ).toThrow();
  expect(() =>
    PickersCursor.parse(compressed('{"source":"midway","phase":"complete"}')),
  ).toThrow();
  expect(() =>
    PickersCursor.parse('{"encoding":"gzip-base64","data":"AAAA"}'),
  ).toThrow();
});
