import { expect, test } from "bun:test";
import { ArrivalWindow } from "./arrival-window";

const now = Date.parse("2026-11-19T12:00:00Z");

test("arrival windows use arrival timestamps, excluding unknown and future dates", () => {
  for (const [window, hours] of [
    ["24h", 24],
    ["48h", 48],
    ["7d", 168],
  ] as const) {
    expect(ArrivalWindow.filter(window, now)).toBe(
      `availableDateTs >= ${now / 1000 - hours * 3600} AND availableDateTs <= ${now / 1000}`,
    );
  }
  expect(ArrivalWindow.filter(undefined, now)).toBeUndefined();
});

test("window URLs accept repeated parameters and reject unknown windows", () => {
  expect(
    ArrivalWindow.fromUrl(new URLSearchParams("arrivalWindow%5B%5D=7d")),
  ).toBe("7d");
  expect(ArrivalWindow.fromUrl(new URLSearchParams("arrivalWindow=24h"))).toBe(
    "24h",
  );
  expect(
    ArrivalWindow.fromUrl(new URLSearchParams("arrivalWindow[]=forever")),
  ).toBeUndefined();
});
