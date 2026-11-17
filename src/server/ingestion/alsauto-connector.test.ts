import { expect, test } from "bun:test";
import { Effect } from "effect";
import { alsautoSnapshot, type AlsautoVehicle } from "./alsauto-snapshot";
import { inspectAlsautoEvidence } from "./alsauto-protocol";
import { parseAlsautoOwner, parseAlsautoPage } from "./alsauto-parser";
import { AlsautoCursor } from "./alsauto-cursor";
import { streamAlsautoInventory } from "./alsauto-connector";
import {
  alsautoEvidence,
  alsautoReader,
  alsautoUrls,
} from "./alsauto-test-fixtures";
import { soakAlsautoInventory } from "../../../scripts/soak-alsauto";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-cursor";
import { VehicleDestination } from "~/lib/vehicle-destination";

const ready = () => {
  const progress = inspectAlsautoEvidence(alsautoEvidence);
  if (progress.kind !== "ready")
    throw new Error("Fixture must include all actual controls");
  return progress.records;
};

test("actual opening and closing census yields 693 accepted donors and ten retained rejects", () => {
  const records = ready();
  const snapshot = alsautoSnapshot(
    records,
    694,
    new Date("2026-11-17T12:00:00Z"),
  );
  expect(records).toHaveLength(703);
  expect(snapshot.errors).toEqual([]);
  expect(snapshot.vehicles).toHaveLength(693);
  expect(snapshot.accounting).toEqual({
    recordsProcessed: 703,
    recordsRejected: 10,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  });
  expect(
    snapshot.vehicles.every(
      (v) =>
        v.stateAbbr === "WI" &&
        v.locationCode === "franklin" &&
        v.imageUrl === null,
    ),
  ).toBe(true);
  expect(
    snapshot.vehicles
      .map((v) => v.availableDate)
      .sort()
      .at(-1),
  ).toBe("2026-11-06");
  expect(snapshot.vehicles.filter((v) => v.make === "Nissan")).not.toHaveLength(
    0,
  );
  expect(
    VehicleDestination.resolve({
      source: "alsauto",
      detailsUrl: "https://www.copart.com/lot/70223596",
    }),
  ).toMatchObject({ kind: "manual-search", href: alsautoUrls[0] });
});

test("every prefix derives its exact next native URL and partial terminal cursors fail", () => {
  for (let length = 0; length < alsautoEvidence.length; length++) {
    expect(inspectAlsautoEvidence(alsautoEvidence.slice(0, length))).toEqual({
      kind: "pending",
      url: alsautoUrls[length] ?? "missing fixture URL",
    });
  }
  expect(() => AlsautoCursor.complete(AlsautoCursor.initial())).toThrow(
    "omits required",
  );
  const initial = AlsautoCursor.initial(694);
  expect(() =>
    AlsautoCursor.parse({ ...initial, previousAcceptedCount: 695 }),
  ).toThrow("checksum");
  expect(() => AlsautoCursor.parse(initial, null)).toThrow("binding");
}, 60000);

test("cached HTML pagination, wrong page, count truncation and closing drift fail closed", () => {
  const first = alsautoEvidence[1] ?? "";
  expect(() => parseAlsautoPage(first, 2)).toThrow("wrong current page");
  expect(() =>
    parseAlsautoPage(first.replace("703 vehicles", "704 vehicles"), 1),
  ).not.toThrow();
  expect(() =>
    inspectAlsautoEvidence([alsautoEvidence[0] ?? "", first, first]),
  ).toThrow("wrong current page");
  expect(() =>
    inspectAlsautoEvidence(
      alsautoEvidence.map((raw, index) =>
        index === 31
          ? raw.replaceAll("2GNALBEK7C1143724", "2GNALBEK1D1225188")
          : raw,
      ),
    ),
  ).toThrow("closing inventory changed");
  expect(() =>
    inspectAlsautoEvidence(
      alsautoEvidence.map((raw, index) =>
        index === 2 ? raw.replace("703 vehicles", "704 vehicles") : raw,
      ),
    ),
  ).toThrow("opening total");
  expect(() =>
    parseAlsautoOwner(
      (alsautoEvidence[0] ?? "").replaceAll(
        "10942 S 124th Street",
        "10943 S 124th Street",
      ),
    ),
  ).toThrow("ownership");
  expect(() => parseAlsautoPage(first.slice(0, -30), 1)).toThrow();
});

test("conflicting VIN identity, missing fields, bad check digits, floor, prior count and freshness guard publication", () => {
  const records = ready();
  const first = records[0];
  if (!first) throw new Error("Missing fixture donor");
  const conflict = alsautoSnapshot(
    [...records, { ...first, lot: "99999999" }],
    null,
    new Date("2026-11-17"),
  );
  expect(conflict.observedVins).toContain(first.vin);
  expect(conflict.vehicles.some((v) => v.vin === first.vin)).toBe(false);
  const invalid = alsautoSnapshot(
    records.map((r) => ({ ...r, vin: "2GNALBEK0C1143724" })),
    null,
    new Date("2026-11-17"),
  );
  expect(invalid.vehicles).toHaveLength(0);
  expect(invalid.errors.join(" ")).toContain("floor");
  expect(
    alsautoSnapshot(records, 2000, new Date("2026-11-17")).errors.join(" "),
  ).toContain("50% drift");
  expect(
    alsautoSnapshot(records, null, new Date("2027-02-01")).errors.join(" "),
  ).toContain("older than 60 days");
});

test("durable chunks publish once, only after all 62 actual controls, and do not refetch on terminal replay", async () => {
  const reader = alsautoReader();
  const emitted: AlsautoVehicle[][] = [];
  const result = await soakAlsautoInventory(async (cursor, maxPages) => {
    const restored = parseDurableSourceCursor(
      "alsauto",
      serializeDurableSourceCursor(cursor),
    );
    const chunk = await Effect.runPromise(
      streamAlsautoInventory({
        now: new Date("2026-11-17T12:00:00Z"),
        previousAcceptedCount: null,
        startCursor: restored,
        maxPages,
        readPage: reader.readPage,
        onBatch: (vehicles) =>
          Effect.sync(() => {
            emitted.push(vehicles);
          }),
        onYards: (yards) =>
          Effect.sync(() => {
            expect(reader.calls).toHaveLength(62);
            expect(yards[0]?.city).toBe("Franklin");
          }),
      }),
    );
    if (chunk.status === "paused") {
      expect(emitted).toEqual([]);
      expect(chunk.count).toBe(0);
      expect(chunk.accounting.recordsProcessed).toBe(0);
    }
    return chunk;
  });
  expect(result.status).toBe("complete");
  expect(result.pagesProcessed).toBe(62);
  expect(result.count).toBe(693);
  expect(reader.calls).toEqual(alsautoUrls);
  expect(emitted).toHaveLength(1);
  expect(
    parseDurableSourceCursor(
      "alsauto",
      serializeDurableSourceCursor(result.cursor),
    ).phase,
  ).toBe("complete");
  const replay = await Effect.runPromise(
    streamAlsautoInventory({
      now: new Date("2026-11-17T12:00:00Z"),
      previousAcceptedCount: null,
      startCursor: result.cursor,
      readPage: reader.readPage,
      onBatch: () => Effect.die("must not emit twice"),
    }),
  );
  expect(replay.pagesProcessed).toBe(0);
}, 60000);

test("closing drift fails before either canonical callback", async () => {
  const reader = alsautoReader((raw, index) =>
    index === 31
      ? raw.replaceAll("2GNALBEK7C1143724", "2GNALBEK1D1225188")
      : raw,
  );
  let cursor = AlsautoCursor.initial();
  await expect(
    (async () => {
      for (;;) {
        const chunk = await Effect.runPromise(
          streamAlsautoInventory({
            now: new Date("2026-11-17T12:00:00Z"),
            previousAcceptedCount: null,
            startCursor: cursor,
            readPage: reader.readPage,
            onBatch: () => Effect.die("unexpected batch"),
            onYards: () => Effect.die("unexpected yard"),
          }),
        );
        cursor = chunk.cursor;
        if (chunk.status === "complete") break;
      }
    })(),
  ).rejects.toThrow("closing inventory changed");
}, 60000);
