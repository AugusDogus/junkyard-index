import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { Effect } from "effect";
import { AlsautoProviderError } from "./alsauto-client";
import { ALSAUTO_CATALOG, alsautoPageUrl } from "./alsauto-configuration";

// Actual distinct opening and closing November 17, 2026 HTTP captures.
export const alsautoEvidence = z
  .array(z.string())
  .length(62)
  .parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL("./alsauto-test-fixtures/evidence.json.gz", import.meta.url),
        ),
      ).toString("utf8"),
    ),
  );
export const alsautoUrls = [
  ALSAUTO_CATALOG,
  ...Array.from({ length: 30 }, (_, index) => alsautoPageUrl(index + 1)),
  ...Array.from({ length: 30 }, (_, index) => alsautoPageUrl(index + 1)),
  ALSAUTO_CATALOG,
];
export function alsautoReader(change?: (raw: string, index: number) => string) {
  let index = 0;
  const calls: string[] = [];
  return {
    calls,
    readPage: (url: string) => {
      const raw = alsautoEvidence[index];
      if (url !== alsautoUrls[index] || raw === undefined)
        return Effect.fail(
          new AlsautoProviderError("fixture destination", `${index}: ${url}`),
        );
      calls.push(url);
      const current = index++;
      return Effect.succeed(change?.(raw, current) ?? raw);
    },
  };
}
