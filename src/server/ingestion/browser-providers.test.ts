import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BROWSER_PROVIDERS } from "./browser-providers";

test("every live browser source opens Kernel browsers; the retired 603 and Michigan Truck stay on Hyperbrowser", () => {
  expect(BROWSER_PROVIDERS).toEqual({
    bigd: "kernel",
    northwest: "kernel",
    vanderhaags: "kernel",
    upullitdavie: "kernel",
    upullrparts: "kernel",
    six03: "hyperbrowser",
    michigantruck: "hyperbrowser",
  });
});

test("no ingestion module names a browser provider directly, so BROWSER_PROVIDERS alone chooses each source's provider", () => {
  const direct = readdirSync(import.meta.dir)
    .filter(
      (file) =>
        file.endsWith(".ts") &&
        !file.endsWith(".test.ts") &&
        file !== "document-transport.ts",
    )
    .filter((file) =>
      /DocumentTransport\.(hyperbrowser|kernel|providerSessions)\(/.test(
        readFileSync(join(import.meta.dir, file), "utf8"),
      ),
    );
  expect(direct).toEqual([]);
});
