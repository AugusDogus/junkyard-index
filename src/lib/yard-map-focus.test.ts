import { expect, test } from "bun:test";
import { nextYardPin } from "./yard-map-focus";

test("arrow navigation reaches every pin and wraps without adding Tab stops", () => {
  for (const key of ["ArrowDown", "ArrowRight"]) {
    expect(nextYardPin(0, 386, key)).toBe(1);
    expect(nextYardPin(385, 386, key)).toBe(0);
  }
  for (const key of ["ArrowUp", "ArrowLeft"]) {
    expect(nextYardPin(0, 386, key)).toBe(385);
    expect(nextYardPin(1, 386, key)).toBe(0);
  }
  expect(nextYardPin(0, 0, "ArrowRight")).toBeNull();
  expect(nextYardPin(0, 386, "Tab")).toBeNull();
  expect(nextYardPin(0, 1, "ArrowRight")).toBe(0);
});
