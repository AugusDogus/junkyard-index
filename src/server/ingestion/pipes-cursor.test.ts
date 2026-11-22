import { expect, test } from "bun:test";
import {
  PipesCursor,
  PIPES_MAX_CURSOR_BYTES,
  PIPES_MAX_RESTARTS,
  pipesReceipt,
} from "./pipes-cursor";
import { pipesHash, pipesRecordHash } from "./pipes-parser";
import {
  pipesTestOwner,
  pipesTestRecord,
  pipesTestDirections,
  pipesTestConfig,
  pipesTestInventory,
  pipesTestNative,
  pipesTestSearch,
} from "./pipes-test-fixtures";

test("Pipes enforces its exact UTF-8 wire byte limit before parse and on checkpoint serialization", () => {
  const baseline = PipesCursor.checkpoint({
    ...PipesCursor.initial,
    opening: [pipesReceipt(pipesTestOwner)],
  });
  let padding =
    PIPES_MAX_CURSOR_BYTES - Buffer.byteLength(PipesCursor.serialize(baseline));
  padding -=
    String(padding + Buffer.byteLength(pipesTestOwner)).length -
    String(Buffer.byteLength(pipesTestOwner)).length;
  const maximum = PipesCursor.checkpoint({
    ...PipesCursor.initial,
    opening: [pipesReceipt(" ".repeat(padding) + pipesTestOwner)],
  });
  const wire = PipesCursor.serialize(maximum);
  expect(Buffer.byteLength(wire)).toBe(PIPES_MAX_CURSOR_BYTES);
  expect(PipesCursor.parse(wire)).toEqual(maximum);
  expect(() =>
    PipesCursor.checkpoint({
      ...PipesCursor.initial,
      opening: [pipesReceipt(" ".repeat(padding + 1) + pipesTestOwner)],
    }),
  ).toThrow("one MiB");
  expect(() =>
    PipesCursor.parse("é".repeat(PIPES_MAX_CURSOR_BYTES / 2 + 1)),
  ).toThrow("before JSON");
});
test("Pipes union limit includes native observations that have no stock key", () => {
  const rows = Array.from({ length: 1001 }, () => ({
    ...pipesTestNative,
    stock: null,
    photos: [],
    images: [],
  }));
  const records = Array.from({ length: 1001 }, (_, index) => ({
    ...pipesTestRecord,
    stock: "STK" + String(900000 + index),
    vin: null,
  }));
  expect(() =>
    PipesCursor.checkpoint({
      ...PipesCursor.initial,
      phase: "closing-native",
      opening: [
        pipesTestOwner,
        pipesTestInventory([]),
        pipesTestDirections,
        pipesTestConfig,
      ].map(pipesReceipt),
      native: [
        {
          make: "FORD",
          rows,
          hash: pipesHash({ make: "FORD", rows }),
          bodyHash: "f".repeat(64),
          bytes: 1,
        },
      ],
      queries: [pipesReceipt(pipesTestSearch(records))],
    }),
  ).toThrow("union");
});
test("Pipes repeat-stock fingerprint excludes only derived daysInYard", () => {
  expect(pipesRecordHash(pipesTestRecord)).toBe(
    pipesRecordHash({ ...pipesTestRecord, daysInYard: 99 }),
  );
  expect(pipesRecordHash(pipesTestRecord)).not.toBe(
    pipesRecordHash({
      ...pipesTestRecord,
      recencyAnchor: "2026-11-11T17:00:00-06:00",
    }),
  );
  expect(pipesRecordHash(pipesTestRecord)).not.toBe(
    pipesRecordHash({
      ...pipesTestRecord,
      imageUrl: "https://www.pipesupullit.net/PipesPhotos/STK041000.jpg",
    }),
  );
});
test("Pipes refuses a legacy checkpoint whose scope did not bind the search destination", () => {
  // Valid prior initial checkpoint, including its original complete checksum.
  const legacy =
    '{"version":1,"scope":"7256292ca9e27d3a25b784f80cea3454d9137f0b71f172bbe4e2b8556ffc6521","checksum":"5c1ddbb1b2bcfa6be3160037d78b75ab966180520dd1a34f123d293656352c89","opening":[],"native":[],"queries":[],"closingNative":[],"bookends":[],"closingContext":[],"phase":"opening"}';
  expect(() => PipesCursor.parse(legacy)).toThrow();
});
test("Pipes keeps checkpoints saved before restarts valid and bounds the restart counter", () => {
  const legacy = JSON.stringify({
    ...PipesCursor.initial,
    source: undefined,
    restarts: undefined,
  });
  expect(legacy).not.toContain("restarts");
  expect(PipesCursor.parse(legacy)).toEqual(PipesCursor.initial);
  const restarted = PipesCursor.restart(
    PipesCursor.restart(PipesCursor.initial),
  );
  expect(restarted.restarts).toBe(PIPES_MAX_RESTARTS);
  expect(() => PipesCursor.restart(restarted)).toThrow();
});
