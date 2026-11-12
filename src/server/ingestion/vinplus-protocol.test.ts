import { expect, test } from "bun:test";
import { z } from "zod";
import {
  jolietTestAnalytics,
  jolietTestRecord,
  jolietTestSearch,
} from "./joliet-test-fixtures";
import {
  parseVinplusAnalytics,
  parseVinplusSearch,
  vinplusQuery,
} from "./vinplus-protocol";

const scope = {
  yardId: "joliet_u_pull_it",
  yardName: "Joliet U-Pull-It",
  sourceSystem: "crush",
  stockSchema: z.string().regex(/^STK\d{6}$/),
  maxStocks: 10_000,
};
const pair = { make: "FORD", model: "TAURUS" };
test("VinPlus exact query preserves supplied native make/model values and scope", () => {
  expect(
    vinplusQuery(scope, { make: "SOURCE MAKE", model: "P.U. 1500" }),
  ).toEqual({
    yard_id: "joliet_u_pull_it",
    make: "SOURCE MAKE",
    model: "P.U. 1500",
    year_min: null,
    year_max: null,
    language: "en",
    location_id: null,
  });
});
test.each([
  (body: string) => body.replace('"match_count":1', '"match_count":2'),
  (body: string) =>
    body.replace('"yard_id":"joliet_u_pull_it"', '"yard_id":"other"'),
  (body: string) =>
    body.replace('"model":"TAURUS","yard_id"', '"model":"OTHER","yard_id"'),
  (body: string) =>
    body.replace(
      '"yardLocation":"Joliet U-Pull-It"',
      '"yardLocation":"Other Yard"',
    ),
  (body: string) =>
    body.replace('"sourceSystem":"crush"', '"sourceSystem":"other"'),
  (body: string) =>
    body.replace('"success":true', '"success":true,"next_page":2'),
  (body: string) => body.replace('"stock":"STK075102"', '"stock":"INVALID"'),
])(
  "VinPlus rejects incomplete, foreign or changed response contracts (%#)",
  (rewrite) => {
    expect(() =>
      parseVinplusSearch(rewrite(jolietTestSearch()), scope, pair),
    ).toThrow();
  },
);
test("VinPlus rejects within-response duplicate stocks", () => {
  expect(() =>
    parseVinplusSearch(
      jolietTestSearch([jolietTestRecord, jolietTestRecord]),
      scope,
      pair,
    ),
  ).toThrow("duplicate");
});
test.each([
  (body: string) => body.replace('"current_count":1', '"current_count":2'),
  (body: string) => body.replace('"year":"2014"', '"year":"Unknown"'),
  (body: string) =>
    body.replace('"success":true', '"success":true,"partial":true'),
])("VinPlus analytics preserve exact current scope (%#)", (rewrite) => {
  expect(() =>
    parseVinplusAnalytics(rewrite(jolietTestAnalytics()), 10_000),
  ).toThrow();
});
