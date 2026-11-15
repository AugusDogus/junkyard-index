import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Effect } from "effect";
import { ChasencarsProviderError } from "./chasencars-client";
import type { ChasencarsRecord } from "./chasencars-parser";
import {
  CHASENCARS_CATALOG,
  CHASENCARS_OWNER,
  CHASENCARS_YARD_URL,
} from "./chasencars-yard-metadata";

// Actual native November15 UTC opening bodies. Separately captured live closing
// bytes are identical, with individual dated receipts in the research directory.
export const chasencarsFixture = (name: "owner" | "yard" | "inventory") =>
  gunzipSync(
    readFileSync(
      new URL(`./chasencars-test-fixtures/${name}.html.gz`, import.meta.url),
    ),
  ).toString("utf8");
export function chasencarsReader(
  change?: (raw: string, url: string, call: number) => string,
) {
  const calls: string[] = [];
  return {
    calls,
    readPage: (url: string) => {
      calls.push(url);
      const name =
        url === CHASENCARS_OWNER
          ? "owner"
          : url === CHASENCARS_YARD_URL
            ? "yard"
            : url === CHASENCARS_CATALOG
              ? "inventory"
              : null;
      if (!name)
        return Effect.fail(
          new ChasencarsProviderError("fixture destination", url),
        );
      const body = chasencarsFixture(name);
      return Effect.succeed(change?.(body, url, calls.length) ?? body);
    },
  };
}
export function chasencarsTestRecord(index: number): ChasencarsRecord {
  return {
    year: "2005",
    make: "FORD",
    model: "FOCUS",
    engine: "",
    color: "",
    vin: "1FAFP000000" + String(index).padStart(6, "0"),
    stock: "STK" + String(index).padStart(6, "0"),
    row: "1",
    arrived: "11/14/26",
  };
}
