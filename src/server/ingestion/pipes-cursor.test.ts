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
  // Wire bytes serialized by the cursor code before restarts existed.
  const legacyInitial =
    '{"version":1,"scope":"c4a9096b4f420b3d57483f6a5b21ebb283f15f334cfc08a3af51df8f22bae313","checksum":"6a4067d0f8bc02cf113e4688fa793fd0c176b6f75fa9f45cc2c60f2cdb0cb30f","opening":[],"native":[],"queries":[],"closingNative":[],"bookends":[],"closingContext":[],"phase":"opening"}';
  expect(PipesCursor.parse(legacyInitial)).toEqual(PipesCursor.initial);
  expect(PipesCursor.initial.checksum).toBe(
    "6a4067d0f8bc02cf113e4688fa793fd0c176b6f75fa9f45cc2c60f2cdb0cb30f",
  );
  const legacyMidRun = String.raw`{"version":1,"scope":"c4a9096b4f420b3d57483f6a5b21ebb283f15f334cfc08a3af51df8f22bae313","checksum":"9861a36e95de4ec858a4ef24e8db20e927ff04f5ec20cba8476ba7c3e97268b9","opening":[{"raw":"<html><body><p>806 Aero Drive Shreveport, LA 71107</p><a href=\"tel:318-222-9547\">318-222-9547</a><a href=\"/Home/Inventory\">Inventory</a><p>Self-Service Auto Parts Store. Bring your tools to Pipes U-Pull-It. Pipes is not affiliated with U Auto Pull It Auto Parts.</p></body></html>","bodyHash":"9c283acf242f18a1c3bf474f55884b151f00d73bb9bd365119a0b45d3b2e5f8f","bytes":280},{"raw":"<html><body><p>806 Aero Drive Shreveport, LA 71107</p><a href=\"tel:318-222-9547\">318-222-9547</a><a href=\"/Home/Inventory\">Inventory</a><form id=\"searchinventory\" action=\"/Home/Inventory\" method=\"post\"><select name=\"VehicleMake\"><option value=\"\">Select Make</option><option value=\"FORD\">FORD</option></select><select name=\"VehicleModel\"><option value=\"\">Select Model</option></select></form><table><tr><th>YEAR</th><th>MAKE</th><th>MODEL</th><th>COLOR</th><th>REFERENCE</th><th>ROW</th><th>ARRIVAL DATE</th><th>PHOTO</th></tr></table><a href=\"https://vinplus.texnrewards.com/parts/pipes-shreveport\">Alerts</a></body></html>","bodyHash":"c565edd124cbe3cb5fda5bfa65050d29095d25bcf685d26d43cbfdc1e7e25cdc","bytes":623}],"native":[],"queries":[],"closingNative":[],"bookends":[],"closingContext":[],"phase":"opening"}`;
  const midRun = PipesCursor.parse(legacyMidRun);
  expect(midRun.checksum).toBe(
    "9861a36e95de4ec858a4ef24e8db20e927ff04f5ec20cba8476ba7c3e97268b9",
  );
  expect(midRun.restarts).toBe(0);
  expect(midRun.opening).toHaveLength(2);
  const restarted = PipesCursor.restart(
    PipesCursor.restart(PipesCursor.initial),
  );
  expect(restarted.restarts).toBe(PIPES_MAX_RESTARTS);
  expect(() => PipesCursor.restart(restarted)).toThrow();
});
