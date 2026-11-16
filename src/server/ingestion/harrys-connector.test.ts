import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { Effect } from "effect";
import { harrysChallengeCookie } from "./harrys-challenge";
import { parseHarrysOwner, parseHarrysPage } from "./harrys-parser";
import { HarrysCursor } from "./harrys-cursor";
import { streamHarrysInventory } from "./harrys-connector";
import { HarrysProviderError } from "./harrys-client";
import { harrysSnapshot, validateHarrysSnapshot } from "./harrys-transform";
import { HARRYS_OWNER, harrysPageUrl } from "./harrys-yard-metadata";
import { prattElements, prattText } from "./pratt-html";
const samples = z
  .record(z.string())
  .parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL("./harrys-test-fixtures/samples.json.gz", import.meta.url),
        ),
      ).toString(),
    ),
  );
const fixture = (name: string) => {
  const raw = samples[name];
  if (raw === undefined) throw new Error("Missing offline fixture " + name);
  return raw;
};
const first = () => parseHarrysPage(fixture("first"), 0);
const challenge = (script: string) => `<script>S='${btoa(script)}';</script>`;
describe("Harry's native census", () => {
  test("the canonical donor detail independently agrees with the inventory identity and yard", () => {
    const detail = fixture("detail");
    const donor = first().records[0];
    if (!donor) throw new Error("Missing saved donor identity");
    const heading = prattElements(detail, "h1").map((h) => prattText(h.body));
    expect(heading).toContain("2015 Chrysler 200 at Allentown Yard");
    const claims = prattElements(detail, "tr").map((row) =>
      prattElements(row.body, "td").map((cell) => prattText(cell.body)),
    );
    for (const claim of [
      ["Yard City", "Allentown"],
      ["Vehicle Year", "2015"],
      ["Vehicle Make", "Chrysler"],
      ["Vehicle Model", "200"],
      ["VIN Number", donor.vin],
    ])
      expect(claims).toContainEqual(claim);
  });
  test("solves only the known Sucuri literal grammar without executing remote JavaScript", () => {
    expect(harrysChallengeCookie(fixture("challenge"))).toBe(
      "sucuri_cloudproxy_uuid_480b08d14=da6a1d9be47ef21818d6edc76605c366",
    );
    expect(harrysChallengeCookie(fixture("challenge2"))).toBe(
      "sucuri_cloudproxy_uuid_7cd8cae59=9f61a38b23edf0c2f091620e8f43922e",
    );
    const good = `r='0123456789abcdef0123456789abcdef';document.cookie='sucuri_cloudproxy_uuid_123456789=' + r + ';path=/;max-age=86400;SameSite=Lax;Secure'; location.reload();`;
    expect(harrysChallengeCookie(challenge(good))).toBe(
      "sucuri_cloudproxy_uuid_123456789=0123456789abcdef0123456789abcdef",
    );
    for (const script of [
      good.replace("r='", "r=alert('ran')+'"),
      good.replace(" + r + ", " + q + "),
      good + "fetch('https://evil.test')",
      good.replace("86400", "90000"),
      good.replace("123456789", "not-qualified"),
      good.replace(
        "'0123456789abcdef0123456789abcdef'",
        "String.fromCharCode(10)",
      ),
    ])
      expect(() => harrysChallengeCookie(challenge(script))).toThrow();
    expect(() => harrysChallengeCookie("<html>changed</html>")).toThrow();
    expect(() =>
      harrysChallengeCookie(fixture("challenge").repeat(2)),
    ).toThrow();
  });
  test("validates native ownership, three-yard scope, zero-based ranges and next links", () => {
    parseHarrysOwner(fixture("owner"));
    expect(first()).toMatchObject({
      index: 0,
      total: 4283,
      records: expect.arrayContaining([
        expect.objectContaining({
          vin: "1C3CCCAB7FN746659",
          yard: "ALLENTOWN",
        }),
      ]),
    });
    for (const raw of [
      fixture("first")
        .replace("4283 records", "4282 records")
        .replace("1 to 15", "1 to 14"),
      fixture("first").replace("inv[page]=1", "inv[page]=2"),
      fixture("first").replace("'PENNSBURG'", "'PLAINS'"),
      fixture("first").replace("Yard City", "Location"),
      fixture("first").replace("</html>", ""),
      fixture("first").replace(
        '<div class="results">',
        '<div class="results"><button>Load more</button>',
      ),
    ])
      expect(() => parseHarrysPage(raw, 0)).toThrow();
    expect(() => parseHarrysPage(fixture("first"), 1)).toThrow();
    expect(() =>
      parseHarrysOwner(
        fixture("owner").replaceAll(
          "1510 East Jonathan Street",
          "different address",
        ),
      ),
    ).toThrow();
  });
  test("validates VIN check digits, required identity and physical yard, preserving nullable optional fields", () => {
    const record = first().records[0];
    if (!record) throw new Error("fixture donor missing");
    expect(harrysSnapshot([record]).vehicles[0]).toMatchObject({
      source: "harrys",
      locationCode: "allentown",
      color: null,
      imageUrl: null,
      stockNumber: null,
      row: "204",
      availableDate: "2026-11-12",
    });
    for (const change of [
      { vin: "1C3CCCAB0FN746659" },
      { vin: "" },
      { year: "invalid" },
      { model: "UNKNOWN" },
      { make: "" },
      { yard: "PLAINS" },
    ])
      expect(
        harrysSnapshot([{ ...record, ...change }]).accounting.recordsRejected,
      ).toBe(1);
    const optional = harrysSnapshot([
      { ...record, color: "UNKNOWN", row: "", date: "99/99/2026" },
    ]);
    expect(optional.vehicles[0]).toMatchObject({
      color: null,
      row: null,
      availableDate: null,
    });
    expect(
      harrysSnapshot([{ ...record, year: "1970", vin: "AB12345" }]).vehicles,
    ).toHaveLength(1);
    const conflict = harrysSnapshot([
      record,
      { ...record, model: "OTHER MODEL" },
    ]);
    expect(conflict.vehicles).toHaveLength(0);
    expect(conflict.accounting.recordsRejected).toBe(2);
    expect(conflict.observedVins).toEqual([record.vin]);
    expect(harrysSnapshot([record, record]).accounting.duplicateVehicles).toBe(
      1,
    );
    expect(() =>
      validateHarrysSnapshot(harrysSnapshot([record]), [record]),
    ).toThrow("floor");
  });
  test("serializes progress, never emits an incomplete census and rejects repeated IDs and corrupt cursors", async () => {
    const requested: string[] = [];
    let emitted = 0;
    const result = await Effect.runPromise(
      streamHarrysInventory({
        maxPages: 2,
        readPage: (url) => {
          requested.push(url);
          return url === HARRYS_OWNER
            ? Effect.succeed(fixture("owner"))
            : url === harrysPageUrl(0)
              ? Effect.succeed(fixture("first"))
              : Effect.fail(
                  new HarrysProviderError(
                    "offline replay",
                    "Unexpected URL " + url,
                  ),
                );
        },
        onBatch: (v) =>
          Effect.sync(() => {
            emitted += v.length;
          }),
      }),
    );
    expect(requested).toEqual([HARRYS_OWNER, harrysPageUrl(0)]);
    expect(result.status).toBe("paused");
    expect(emitted).toBe(0);
    expect(result.count).toBe(0);
    expect(
      HarrysCursor.fromWire(HarrysCursor.serialize(result.cursor)),
    ).toEqual(result.cursor);
    expect(() =>
      HarrysCursor.fromWire(
        HarrysCursor.serialize(result.cursor).replace(
          '"closed":0',
          '"closed":1',
        ),
      ),
    ).toThrow();
    expect(() =>
      HarrysCursor.checkpoint({ ...result.cursor, phase: "closing" }),
    ).toThrow();
    expect(() =>
      HarrysCursor.checkpoint({
        ...result.cursor,
        pages: [first(), { ...first(), index: 1 }],
      }),
    ).toThrow("repeats");
    expect(() =>
      HarrysCursor.fromWire(" ".repeat(8 * 1024 * 1024 + 1)),
    ).toThrow("8 MiB");
  });
  test("completed checkpoints perform no requests or callbacks", async () => {
    const initial = HarrysCursor.initial();
    const cursor = HarrysCursor.checkpoint({ ...initial, phase: "complete" });
    const result = await Effect.runPromise(
      streamHarrysInventory({
        startCursor: cursor,
        readPage: () => {
          throw new Error("No network allowed");
        },
        onBatch: () => {
          throw new Error("Already complete");
        },
      }),
    );
    expect(result.status).toBe("complete");
    expect(result.pagesProcessed).toBe(0);
  });
});
