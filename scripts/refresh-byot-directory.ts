import { readFile, writeFile } from "node:fs/promises";
import { brotliDecompressSync } from "node:zlib";
import { buildByotDirectory } from "../src/server/ingestion/byot-directory-builder";

/** Offline rebuild from saved native controls, never a live search sweep.
 * Input: [{ path: "/search/models?make=...&year=...", data: ["..."] }, ...]. */
if (import.meta.main) {
  const input = process.argv[2];
  if (!input)
    throw new Error(
      "Usage: bun scripts/refresh-byot-directory.ts <saved-native-controls.json[.br]>. Capture native year-specific makes/models, including older names and Jeep, before replacing the directory.",
    );
  const bytes = await readFile(input);
  const raw = input.endsWith(".br") ? brotliDecompressSync(bytes) : bytes;
  const controls: unknown = JSON.parse(raw.toString("utf8"));
  const queries = buildByotDirectory(controls);
  await writeFile(
    new URL("../src/server/ingestion/byot-directory.json", import.meta.url),
    JSON.stringify(queries, null, 2) + "\n",
  );
  console.log(
    `Wrote ${queries.length} native BYOT queries. Directory changes invalidate saved cursor scopes; requalify and finish or discard old runs before rollout.`,
  );
}
