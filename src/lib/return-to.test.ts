import { describe, expect, test } from "bun:test";
import { ReturnTo } from "./return-to";

describe("ReturnTo", () => {
  for (const input of [
    "https://evil",
    "//evil",
    "/\\evil",
    "%2F%2Fevil",
    "javascript:",
    "search?q=saab",
    "/\n/evil",
    "/a/..//evil",
    "%E0%A4%A",
    null,
    undefined,
  ]) {
    test(`rejects unsafe destination ${JSON.stringify(input)}`, () => {
      const path: string = ReturnTo.parse(input);
      expect(path).toBe("/search");
    });
  }
  for (const [input, expected] of [
    ["/search?q=Saab%20900&saveSearch=1", "/search?q=Saab%20900&saveSearch=1"],
    [
      "%2Fsearch%3Fq%3DSaab%2520900%26saveSearch%3D1",
      "/search?q=Saab%20900&saveSearch=1",
    ],
    ["/settings/billing?from=menu#plan", "/settings/billing?from=menu#plan"],
  ] as const) {
    test(`preserves same-site destination ${input}`, () => {
      const path: string = ReturnTo.parse(input);
      expect(path).toBe(expected);
    });
  }
});
