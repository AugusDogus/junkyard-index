import { expect, test } from "bun:test";
import { BROWSER_PROVIDERS } from "./browser-providers";

test("Big D and Northwest open Kernel browsers; the retired 603 and Michigan Truck stay on Hyperbrowser", () => {
  expect(BROWSER_PROVIDERS).toEqual({
    bigd: "kernel",
    northwest: "kernel",
    six03: "hyperbrowser",
    michigantruck: "hyperbrowser",
  });
});
