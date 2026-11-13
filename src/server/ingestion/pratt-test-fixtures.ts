import { readFileSync } from "node:fs";
import type { PrattContract } from "./pratt-contract";
import type { PrattResult } from "./pratt-result";
import { inventoryHtmlAttribute } from "./inventory-html";

export const prattFixture = (name: string) =>
  readFileSync(
    new URL("./pratt-test-fixtures/" + name, import.meta.url),
    "utf8",
  );
export const prattFixtureContract: PrattContract = {
  yard: {
    source: "pratt",
    code: "fixture-hoxie",
    name: "Pratt's Auto Salvage",
    operator: "Pratt's Auto Salvage",
    address: "170 Industrial Dr",
    city: "Hoxie",
    state: "AR",
    postalCode: "72433",
    phone: null,
    email: null,
    lat: 36.0533113,
    lng: -90.9844769,
    websiteUrl: "https://prattsautosalvage.com/",
  },
  minimumUniqueInventory: 1,
};
export const prattFixtureLexus = {
  make: { path: "/parts/LEXUS", label: "LEXUS", count: 10 },
  model: { path: "/parts/LEXUS/LEXUS_LS460/", label: "LEXUS LS460", count: 2 },
};
export function prattValue<T>(result: PrattResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
/** Controlled graph reduction of real native fixtures, only for traversal tests.
 * It never represents the real 47-make, 468-model population as complete. */
export function prattOnlyControl(raw: string, href: string): string {
  return raw.replace(
    /(<a\b[^>]*>)[\s\S]*?<\/a>/gi,
    (literal: string, tag: string) =>
      !(inventoryHtmlAttribute(tag, "class") ?? "")
        .split(/\s+/)
        .includes("iis-center-block") ||
      inventoryHtmlAttribute(tag, "href") === href
        ? literal
        : "",
  );
}
