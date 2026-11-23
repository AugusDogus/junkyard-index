import { expect, test } from "bun:test";
import { BROWSER_PROVIDERS } from "./browser-providers";

test("Big D, Northwest, 603 and Michigan Truck stay on Hyperbrowser until they are moved", () => {
  expect(BROWSER_PROVIDERS).toEqual({
    bigd: "hyperbrowser",
    northwest: "hyperbrowser",
    six03: "hyperbrowser",
    michigantruck: "hyperbrowser",
  });
});
