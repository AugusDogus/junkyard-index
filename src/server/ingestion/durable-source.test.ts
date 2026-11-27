import { describe, expect, test } from "bun:test";
import {
  DURABLE_INITIAL_SOURCE_CURSORS,
  DURABLE_SOURCE_DEFINITIONS,
  durableSourceCursorEquals,
  durableSourceChunkProgressError,
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-source";
import type { DurableCursorFor } from "./durable-cursor";
import { INGESTION_SOURCES } from "~/lib/ingestion-source";
import { KodakCursor } from "./kodak-cursor";
import { Six03Cursor } from "./six03-cursor";
import { RohnerCursor } from "./rohner-cursor";
import { ScottsCursor } from "./scotts-cursor";
import { OemCursor } from "./oem-cursor";
import { DutchersCursor } from "./dutchers-cursor";
import { ChasencarsCursor } from "./chasencars-cursor";
import { WeberbrothersCursor } from "./weberbrothers-cursor";
import { OemgarageCursor } from "./oemgarage-cursor";
import { HagermanCursor } from "./hagerman-cursor";
import { KandrCursor } from "./kandr-cursor";
import { KANDR_CONTRACT } from "./kandr-configuration";
import { JimsimportCursor } from "./jimsimport-cursor";

describe("durable ingestion cursors", () => {
  test.each([
    "lonestarimports",
    "alshned",
    "cstruck",
    "heavytruckparts",
  ] as const)(
    "%s registers a checked resumable cursor and rejects false completion",
    (source) => {
      const definition = DURABLE_SOURCE_DEFINITIONS[source];
      expect(definition.maxPagesPerChunk).toBe(source === "alshned" ? 12 : 8);
      const wire = serializeDurableSourceCursor(definition.initialCursor);
      expect(parseDurableSourceCursor(source, wire)).toEqual(
        definition.initialCursor,
      );
      expect(() =>
        parseDurableSourceCursor(
          source,
          wire.replace(/"phase":"[^"]+"/, '"phase":"complete"'),
        ),
      ).toThrow();
    },
  );
  test("registers Jim's Import with eight native GETs and a checked durable cursor", () => {
    const initial = JimsimportCursor.initial();
    expect(DURABLE_SOURCE_DEFINITIONS).toHaveProperty(
      "jimsimport",
      expect.objectContaining({
        initialCursor: initial,
        maxPagesPerChunk: 8,
      }),
    );
    const wire = serializeDurableSourceCursor(initial);
    expect(parseDurableSourceCursor("jimsimport", wire)).toEqual(initial);
    expect(() =>
      parseDurableSourceCursor(
        "jimsimport",
        wire.replace('"owner"', '"complete"'),
      ),
    ).toThrow();
  });
  test("registers K&R with eight native GETs and a checked durable cursor", () => {
    const initial = KandrCursor.initial(KANDR_CONTRACT);
    if (!initial.ok) throw new Error(initial.error.message);
    expect(DURABLE_SOURCE_DEFINITIONS).toHaveProperty(
      "kandr",
      expect.objectContaining({
        initialCursor: initial.value,
        maxPagesPerChunk: 8,
      }),
    );
    const wire = serializeDurableSourceCursor(initial.value);
    expect(parseDurableSourceCursor("kandr", wire)).toEqual(initial.value);
    expect(() =>
      parseDurableSourceCursor(
        "kandr",
        wire.replace('"collecting"', '"complete"'),
      ),
    ).toThrow();
  });
  test("registers Hagerman with twelve native GETs and a validated durable cursor", () => {
    expect(DURABLE_SOURCE_DEFINITIONS).toHaveProperty(
      "hagerman",
      expect.objectContaining({
        initialCursor: HagermanCursor.initial,
        maxPagesPerChunk: 12,
      }),
    );
    const wire = serializeDurableSourceCursor(HagermanCursor.initial);
    expect(parseDurableSourceCursor("hagerman", wire)).toEqual(
      HagermanCursor.initial,
    );
    expect(() =>
      parseDurableSourceCursor(
        "hagerman",
        wire.replace('"start"', '"complete"'),
      ),
    ).toThrow();
  });
  test("registers oeM Garage with eight native GETs and a checked durable cursor", () => {
    const initial = OemgarageCursor.initial();
    expect(DURABLE_SOURCE_DEFINITIONS).toHaveProperty(
      "oemgarage",
      expect.objectContaining({
        initialCursor: initial,
        maxPagesPerChunk: 8,
      }),
    );
    const wire = serializeDurableSourceCursor(initial);
    expect(parseDurableSourceCursor("oemgarage", wire)).toEqual(initial);
    expect(() =>
      parseDurableSourceCursor(
        "oemgarage",
        wire.replace('"owner"', '"complete"'),
      ),
    ).toThrow();
  });
  test("registers Weber Brothers with ten native GETs and a validated resumable cursor", () => {
    expect(DURABLE_SOURCE_DEFINITIONS).toHaveProperty(
      "weberbrothers",
      expect.objectContaining({
        initialCursor: WeberbrothersCursor.initial,
        maxPagesPerChunk: 10,
      }),
    );
    const wire = serializeDurableSourceCursor(WeberbrothersCursor.initial);
    expect(parseDurableSourceCursor("weberbrothers", wire)).toEqual(
      WeberbrothersCursor.initial,
    );
  });
  test("registers Chase N Cars with six physical GETs per checkpoint", () => {
    expect(DURABLE_SOURCE_DEFINITIONS).toHaveProperty(
      "chasencars",
      expect.objectContaining({
        initialCursor: ChasencarsCursor.initial(null),
        maxPagesPerChunk: 6,
      }),
    );
  });
  test("registers Dutcher with eight bounded native GETs per checkpoint", () => {
    expect(DURABLE_SOURCE_DEFINITIONS).toHaveProperty(
      "dutchers",
      expect.objectContaining({
        initialCursor: DutchersCursor.initial(),
        maxPagesPerChunk: 8,
      }),
    );
  });
  test("registers OEM with eight bounded native GETs per checkpoint", () => {
    expect(DURABLE_SOURCE_DEFINITIONS).toHaveProperty(
      "oem",
      expect.objectContaining({
        initialCursor: OemCursor.initial(),
        maxPagesPerChunk: 8,
      }),
    );
  });
  test("registers Scott's with six bounded native GETs per checkpoint", () => {
    expect(DURABLE_SOURCE_DEFINITIONS).toHaveProperty(
      "scotts",
      expect.objectContaining({
        initialCursor: ScottsCursor.initial,
        maxPagesPerChunk: 6,
      }),
    );
  });
  test("registers Rohner with three bounded native requests per checkpoint", () => {
    expect(DURABLE_SOURCE_DEFINITIONS).toHaveProperty(
      "rohner",
      expect.objectContaining({
        initialCursor: RohnerCursor.initial,
        maxPagesPerChunk: 3,
      }),
    );
    expect(() =>
      parseDurableSourceCursor(
        "rohner",
        JSON.stringify({ source: "rohner", version: 1, phase: "complete" }),
      ),
    ).toThrow();
  });
  test("registers Kodak and six03 with their frozen native request budgets", () => {
    expect(DURABLE_SOURCE_DEFINITIONS).toHaveProperty(
      "kodak",
      expect.objectContaining({
        initialCursor: KodakCursor.initial,
        maxPagesPerChunk: 2,
      }),
    );
    expect(DURABLE_SOURCE_DEFINITIONS).toHaveProperty(
      "six03",
      expect.objectContaining({
        initialCursor: Six03Cursor.initial,
        maxPagesPerChunk: 8,
      }),
    );
  });
  test.each([
    ["awap", 2],
    ["clearsalvage", 4],
    ["central", 4],
    ["aplus", 4],
    ["sandw", 4],
    ["beavers", 2],
    ["indianriver", 8],
    ["harrys", 8],
    ["budget", 8],
    ["denton", 16],
    ["scotts", 2],
    ["oem", 8],
    ["dutchers", 8],
    ["chasencars", 2],
    ["weberbrothers", 8],
    ["oemgarage", 4],
    ["hagerman", 2],
    ["kandr", 4],
    ["jimsimport", 8],
    ["lonestarimports", 16],
    ["alshned", 8],
    ["cstruck", 4],
    ["allied", 8],
    ["urgiis", 16],
    ["byot", 16],
    ["aviation", 4],
    ["six03", 4],
    ["citymotors", 4],
  ] as const)(
    "%s preserves its source-specific wire byte guard",
    (source, limitMiB) => {
      const maximumBytes = limitMiB * 1024 * 1024;
      for (const wire of [
        "x".repeat(maximumBytes + 1),
        '"' + "é".repeat(maximumBytes / 2 + 1) + '"',
      ]) {
        expect(() => parseDurableSourceCursor(source, wire)).toThrow(
          new RegExp(`${limitMiB} ?MiB`),
        );
      }
    },
  );
  test.each(["rustyhook", "chaz", "coutu"] as const)(
    "%s rejects oversized wire before JSON decoding",
    (source) => {
      for (const wire of [
        "x".repeat(1024 * 1024 + 1),
        '"' + "é".repeat(600_000) + '"',
      ]) {
        expect(() => parseDurableSourceCursor(source, wire)).toThrow(/1 MiB/);
      }
    },
  );
  test.each([...INGESTION_SOURCES])(
    "round trips the registered %s initial checkpoint and rejects malformed input",
    (source) => {
      const initial = DURABLE_SOURCE_DEFINITIONS[source].initialCursor;
      expect(
        parseDurableSourceCursor(source, serializeDurableSourceCursor(initial)),
      ).toEqual(initial);
      expect(() =>
        parseDurableSourceCursor(source, '{"phase":"invalid"}'),
      ).toThrow();
    },
  );
  test.each(["kodak", "six03"] as const)(
    "%s preserves strict source/version and complete checkpoint codecs",
    (source) => {
      const initial = DURABLE_SOURCE_DEFINITIONS[source].initialCursor;
      const wire = serializeDurableSourceCursor(initial);
      expect(parseDurableSourceCursor(source, wire)).toEqual(initial);
      expect(() =>
        parseDurableSourceCursor(
          source,
          wire.replace('"version":1', '"version":2'),
        ),
      ).toThrow();
      expect(() =>
        parseDurableSourceCursor(
          source,
          wire.replace(`"source":"${source}"`, '"source":"row52"'),
        ),
      ).toThrow();
      expect(() =>
        parseDurableSourceCursor(
          source,
          wire.slice(0, -1) + ',"extra":"field"}',
        ),
      ).toThrow();
      const complete = { source, version: 1, phase: "complete" } as const;
      expect(
        parseDurableSourceCursor(
          source,
          serializeDurableSourceCursor(complete),
        ),
      ).toEqual(complete);
    },
  );
  test("Kodak applies its native 4 KiB wire guard before JSON parsing", () => {
    for (const wire of ["x".repeat(4097), '"' + "é".repeat(2048) + '"'])
      expect(() => parseDurableSourceCursor("kodak", wire)).toThrow("4 KiB");
  });
  test("round trips RTP per-yard ordering and quality counters", () => {
    const cursor: DurableCursorFor<"rtp"> = {
      source: "rtp",
      phase: "page",
      yardCode: "595",
      offset: 100,
      total: 413,
      lastStock: "000000109287",
      emitted: 94,
      rejected: 5,
      excluded: 1,
    };
    expect(
      parseDurableSourceCursor("rtp", serializeDurableSourceCursor(cursor)),
    ).toEqual(cursor);
    expect(DURABLE_SOURCE_DEFINITIONS.rtp.maxPagesPerChunk).toBe(2);
    expect(() =>
      parseDurableSourceCursor(
        "rtp",
        JSON.stringify({ ...cursor, rejected: 0 }),
      ),
    ).toThrow("Invalid rtp ingestion cursor");
  });
  test.each(["pickers", "pipes", "uwrench"] as const)(
    "%s preserves its bounded source-specific wire codec",
    (source) => {
      const initial = DURABLE_SOURCE_DEFINITIONS[source].initialCursor;
      const wire = serializeDurableSourceCursor(initial);
      const payload: unknown = JSON.parse(wire);
      expect(payload).not.toHaveProperty("source");
      expect(parseDurableSourceCursor(source, wire)).toEqual(initial);
      expect(() =>
        parseDurableSourceCursor(
          source,
          wire.slice(0, -1) + ',"source":"row52"}',
        ),
      ).toThrow();
      // Invalid oversized JSON must fail the byte guard before decoding.
      expect(() =>
        parseDurableSourceCursor(source, "x".repeat(1024 * 1024 + 1)),
      ).toThrow(/MiB/);
      expect(() =>
        parseDurableSourceCursor(source, '"' + "é".repeat(600_000) + '"'),
      ).toThrow(/MiB/);
    },
  );

  test.each(["ipullupull", "partsgalore"] as const)(
    "round trips %s atomic catalog checkpoints",
    (source) => {
      for (const catalog of [0, 1] as const) {
        const cursor = { source, catalog };
        expect(
          parseDurableSourceCursor(
            source,
            serializeDurableSourceCursor(cursor),
          ),
        ).toEqual(cursor);
      }
      expect(() => parseDurableSourceCursor(source, "2")).toThrow();
      expect(() => parseDurableSourceCursor(source, "-1")).toThrow();
    },
  );

  test("round trips Washington's resumable yard page evidence", () => {
    const cursor = {
      source: "upullitwa" as const,
      phase: "page" as const,
      yardId: "UU44",
      page: 2,
      declaredPageCount: 3,
      completedYardIds: ["JJ65", "UU43"],
      pageFingerprints: ["a".repeat(64)],
      usableYardVehicles: 422,
    };
    expect(
      parseDurableSourceCursor(
        "upullitwa",
        serializeDurableSourceCursor(cursor),
      ),
    ).toEqual(cursor);
    expect(() =>
      parseDurableSourceCursor("upullitwa", '{"phase":"page"}'),
    ).toThrow();
  });
  test("registers every canonical ingestion source exactly once", () => {
    expect(Object.keys(DURABLE_SOURCE_DEFINITIONS)).toEqual([
      ...INGESTION_SOURCES,
    ]);
    expect(
      DURABLE_INITIAL_SOURCE_CURSORS.map((cursor) => cursor.source),
    ).toEqual([...INGESTION_SOURCES]);
  });

  test("bounds Row52 checkpoints to one 1,000-vehicle page", () => {
    expect(DURABLE_SOURCE_DEFINITIONS.row52.maxPagesPerChunk).toBe(1);
  });

  test("bounds PYP chunks to thirty pages", () => {
    expect(DURABLE_SOURCE_DEFINITIONS.pyp.maxPagesPerChunk).toBe(30);
  });

  test("starts PYP at the first store and preserves store and page checkpoints", () => {
    expect(DURABLE_SOURCE_DEFINITIONS.pyp.initialCursor).toEqual({
      source: "pyp",
      storeCodes: null,
      storeIndex: 0,
      page: 0,
    });
    const cursor = {
      source: "pyp" as const,
      storeCodes: Array.from({ length: 20 }, (_, index) =>
        String(1200 + index),
      ),
      storeIndex: 1,
      page: 2,
    };
    expect(
      parseDurableSourceCursor("pyp", serializeDurableSourceCursor(cursor)),
    ).toEqual(cursor);
    expect(() =>
      parseDurableSourceCursor(
        "pyp",
        JSON.stringify({ storeCodes: null, storeIndex: 1, page: 0 }),
      ),
    ).toThrow("Invalid pyp ingestion cursor");
    expect(() =>
      parseDurableSourceCursor(
        "pyp",
        JSON.stringify({
          storeCodes: [...cursor.storeCodes].reverse(),
          storeIndex: 1,
          page: 0,
        }),
      ),
    ).toThrow("Invalid pyp ingestion cursor");
  });

  test("rejects old PYP global page cursors", () => {
    expect(() => parseDurableSourceCursor("pyp", "0")).toThrow(
      "Invalid pyp ingestion cursor",
    );
  });

  test("amortizes Pull-A-Part setup across ten make pages", () => {
    expect(DURABLE_SOURCE_DEFINITIONS.pullapart.maxPagesPerChunk).toBe(10);
  });

  test("parses valid integer and pair cursors", () => {
    expect(
      parseDurableSourceCursor("wrenchapart", '{"afterLocationId":4}'),
    ).toEqual({ source: "wrenchapart", afterLocationId: 4 });
    expect(
      serializeDurableSourceCursor({
        source: "wrenchapart",
        afterLocationId: 4,
      }),
    ).toBe('{"afterLocationId":4}');
    // Scalar checkpoints written before the make crawl still resume.
    expect(parseDurableSourceCursor("upullrparts", "0")).toEqual({
      source: "upullrparts",
      phase: "directory",
      storesSeen: [],
    });
    expect(parseDurableSourceCursor("upullrparts", "1")).toEqual({
      source: "upullrparts",
      phase: "complete",
      storesSeen: [],
    });
    const crawl: DurableCursorFor<"upullrparts"> = {
      source: "upullrparts",
      phase: "crawl",
      location: "3",
      today: "2026-11-24",
      end: "2026-11-20",
      statePath: "ingestion/run/upullrparts/chunk.json",
      storesSeen: [1, 2],
    };
    const serialized = serializeDurableSourceCursor(crawl);
    expect(JSON.parse(serialized)).toEqual({
      phase: "crawl",
      location: "3",
      today: "2026-11-24",
      end: "2026-11-20",
      statePath: "ingestion/run/upullrparts/chunk.json",
      storesSeen: [1, 2],
    });
    expect(parseDurableSourceCursor("upullrparts", serialized)).toEqual(crawl);
    // A make-walk checkpoint from an older deployment is not a date cursor.
    expect(() =>
      parseDurableSourceCursor(
        "upullrparts",
        '{"phase":"crawl","location":"3","afterMake":"Ford","storesSeen":[1,2]}',
      ),
    ).toThrow();
    expect(parseDurableSourceCursor("pullnsave", "11")).toEqual({
      source: "pullnsave",
      page: 11,
    });
    expect(parseDurableSourceCursor("tearapart", "1")).toEqual({
      source: "tearapart",
      storeIndex: 1,
    });
    expect(
      serializeDurableSourceCursor({ source: "pullnsave", page: 11 }),
    ).toBe("11");
    expect(
      serializeDurableSourceCursor({ source: "tearapart", storeIndex: 1 }),
    ).toBe("1");
    expect(() => parseDurableSourceCursor("pyp", "12")).toThrow(
      "Invalid pyp ingestion cursor",
    );
    expect(parseDurableSourceCursor("pullapart", "3:7")).toEqual({
      source: "pullapart",
      locationId: 3,
      makeId: 7,
    });
  });

  test("rejects malformed cursors instead of restarting a source", () => {
    expect(() =>
      parseDurableSourceCursor("wrenchapart", '{"afterLocationId":-1}'),
    ).toThrow("Invalid wrenchapart ingestion cursor");
    expect(() => parseDurableSourceCursor("upullrparts", "2")).toThrow(
      "Invalid upullrparts ingestion cursor",
    );
    expect(() => parseDurableSourceCursor("pullnsave", "0")).toThrow(
      "Invalid pullnsave ingestion cursor",
    );
    expect(() => parseDurableSourceCursor("tearapart", "-1")).toThrow(
      "Invalid tearapart ingestion cursor",
    );
    expect(() => parseDurableSourceCursor("pyp", "12x")).toThrow(
      "Invalid pyp ingestion cursor: 12x",
    );
    expect(() => parseDurableSourceCursor("pullapart", "3")).toThrow(
      "Invalid pullapart ingestion cursor: 3",
    );
  });

  test("round trips a Row52 cursor with its active yard group", () => {
    const cursor = {
      source: "row52" as const,
      afterLocationId: 19,
      locationIds: [20, 21, 22],
      skip: 1000,
    };
    const serialized = serializeDurableSourceCursor(cursor);
    expect(serialized).toBe(
      '{"afterLocationId":19,"locationIds":[20,21,22],"skip":1000}',
    );
    expect(parseDurableSourceCursor("row52", serialized)).toEqual(cursor);
    expect(DURABLE_SOURCE_DEFINITIONS.row52.initialCursor).toEqual({
      source: "row52",
      afterLocationId: 0,
      locationIds: [],
      skip: 0,
    });
  });

  test("round trips the Davie catalog metadata needed across chunks", () => {
    const cursor = {
      source: "upullitdavie" as const,
      page: 25,
      totalPages: 61,
      totalCount: 1_460,
      pageSize: 24,
      recordsProcessed: 576,
      recordsRejected: 0,
    };
    const serialized = serializeDurableSourceCursor(cursor);
    expect(serialized).toBe(
      '{"page":25,"totalPages":61,"totalCount":1460,"pageSize":24,"recordsProcessed":576,"recordsRejected":0}',
    );
    expect(parseDurableSourceCursor("upullitdavie", serialized)).toEqual(
      cursor,
    );
    expect(
      durableSourceCursorEquals(cursor, {
        ...cursor,
        recordsRejected: 1,
      }),
    ).toBe(false);
  });

  test("round trips GO Pull-It catalog validation counters", () => {
    const cursor = {
      source: "gopullit" as const,
      page: 25,
      recordsProcessed: 240,
      recordsSkipped: 30,
    };
    const serialized = serializeDurableSourceCursor(cursor);
    expect(serialized).toBe(
      '{"page":25,"recordsProcessed":240,"recordsSkipped":30}',
    );
    expect(parseDurableSourceCursor("gopullit", serialized)).toEqual(cursor);
  });
});

test("paused chunks must advance, while complete chunks may retain their cursor", () => {
  const cursor = { source: "pullnsave", page: 1 } as const;
  expect(
    durableSourceChunkProgressError(cursor, { status: "paused", cursor }),
  ).toBe("Source pullnsave returned its current cursor without completing");
  expect(
    durableSourceChunkProgressError(cursor, { status: "complete", cursor }),
  ).toBeNull();
  expect(
    durableSourceChunkProgressError(cursor, {
      status: "paused",
      cursor: { source: "pullnsave", page: 2 },
    }),
  ).toBeNull();
});
