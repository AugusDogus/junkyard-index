import { expect, test } from "bun:test";
import { Effect } from "effect";
import { z } from "zod";
import {
  vinplusPublicDate,
  vinplusPublicQuery,
} from "./vinplus-public-enrichment";
import { vinplusQuery } from "./vinplus-protocol";

const scope = {
  yardId: "tri_state_iron_metal",
  yardName: "Pickers Texarkana",
  sourceSystem: "crush",
  stockSchema: z.string().regex(/^STK\d{6}$/),
  maxStocks: 10_000,
};

test("public VinPlus query requires explicit location and preserves source selectors", async () => {
  expect(
    await Effect.runPromise(
      vinplusPublicQuery(
        scope,
        { make: "SOURCE MAKE", model: "P.U. 1500" },
        { kind: "per-location", id: "pickers_texarkana" },
      ),
    ),
  ).toEqual({
    yard_id: "tri_state_iron_metal",
    location_id: "pickers_texarkana",
    year_min: null,
    year_max: null,
    make: "SOURCE MAKE",
    model: "P.U. 1500",
    language: "en",
  });
});

test("public VinPlus date preserves a real offset and complete fractional timestamp", () => {
  const raw = "2026-07-07T07:00:35.301260+00:00";
  expect(vinplusPublicDate(raw)).toEqual({
    kind: "offset-timestamp",
    raw,
    value: raw,
    calendarDate: "2026-07-07",
    offset: "+00:00",
  });
});

test("public VinPlus naive timestamp contributes only its native calendar", () => {
  const raw = "2026-09-03T15:17:45.067";
  expect(vinplusPublicDate(raw)).toEqual({
    kind: "calendar",
    raw,
    value: "2026-09-03",
  });
});

test("public VinPlus single-yard scope is explicit and admitted builder stays unchanged", async () => {
  const pair = { make: "FORD", model: "F  150" };
  expect(
    await Effect.runPromise(
      vinplusPublicQuery(scope, pair, { kind: "single-yard" }),
    ),
  ).toEqual(vinplusQuery(scope, pair));
  expect(vinplusQuery(scope, pair).location_id).toBeNull();
  const located = await Effect.runPromise(
    vinplusPublicQuery(scope, pair, {
      kind: "per-location",
      id: "pipes_shreveport",
    }),
  );
  expect(located.location_id).toBe("pipes_shreveport");
  expect(located.model).toBe("F  150");
  expect(vinplusQuery(scope, pair).location_id).toBeNull();
});

test.each(["", " ", "*", "%FORD%", "F*", "bad\nmodel", "<model>"])(
  "public VinPlus rejects unusable or wildcard selector %j as a typed failure",
  async (model) => {
    const result = await Effect.runPromise(
      Effect.either(
        vinplusPublicQuery(
          scope,
          { make: "FORD", model },
          { kind: "per-location", id: "pickers_texarkana" },
        ),
      ),
    );
    expect(result).toMatchObject({
      _tag: "Left",
      left: { _tag: "VinplusPublicProtocolError", operation: "query" },
    });
  },
);

test.each([
  "",
  " ",
  " pickers_texarkana",
  "pickers_texarkana ",
  "*",
  "bad\nid",
])(
  "public VinPlus rejects unusable location %j without a null fallback",
  async (id) => {
    expect(
      await Effect.runPromise(
        Effect.either(
          vinplusPublicQuery(
            scope,
            { make: "FORD", model: "TAURUS" },
            { kind: "per-location", id },
          ),
        ),
      ),
    ).toMatchObject({ _tag: "Left" });
  },
);

test("public VinPlus rejects an empty owner with a usable location", async () => {
  expect(
    await Effect.runPromise(
      Effect.either(
        vinplusPublicQuery(
          { ...scope, yardId: "" },
          { make: "FORD", model: "TAURUS" },
          { kind: "per-location", id: "pickers_texarkana" },
        ),
      ),
    ),
  ).toMatchObject({ _tag: "Left" });
});

test.each([
  ["2026-11-12T00:10:12.001234+14:00", "+14:00"],
  ["2026-11-12T23:50:12-06:00", "-06:00"],
  ["2026-11-12T00:00:00Z", "Z"],
] as const)(
  "public VinPlus preserves offset date %s without UTC conversion",
  (raw, offset) => {
    expect(vinplusPublicDate(raw)).toEqual({
      kind: "offset-timestamp",
      raw,
      value: raw,
      calendarDate: "2026-11-12",
      offset,
    });
  },
);

test("public VinPlus accepts a valid source calendar without an inferred instant", () => {
  expect(vinplusPublicDate("2024-02-29")).toEqual({
    kind: "calendar",
    raw: "2024-02-29",
    value: "2024-02-29",
  });
});

test.each(
  [
    undefined,
    null,
    20261112,
    {},
    [],
    "",
    " 2026-11-12",
    "2026-11-12 ",
    "2026-11-12\n",
    "2026-11-12T01:00:00\n",
    "2026-11-12T01:00:00Z\n",
    "2026-11-12\r\n",
    "2023-02-29",
    "2026-04-31",
    "0001-01-01",
    "2101-01-01",
    "2026-00-01",
    "2026-13-01",
    "2026-11-00",
    "2026-11-12T24:00:00",
    "2026-11-12T01:60:00Z",
    "2026-11-12T01:00:60Z",
    "2026-11-12T01:00:00.1234567Z",
    "2026-11-12T01:00:00+24:00",
    "2026-11-12T01:00:00+00:60",
    "2026-11-12T01:00:00-00:00",
    "2026-11-12+00:00",
    "2026-11-12 01:00:00",
    "2026-11-12T01:00Z",
    "11/12/2026",
  ].map((raw) => [raw] as const),
)("public VinPlus nulls unusable optional date %j", (raw) => {
  expect(vinplusPublicDate(raw)).toBeNull();
});
