import { Glob } from "bun";
import { z } from "zod";

const timingsSchema = z.object({
  version: z.literal(1),
  files: z.record(z.number().finite().nonnegative()),
});

export function verifyTestShards(
  expected: readonly string[],
  shards: readonly (readonly string[])[],
): void {
  const counts = new Map<string, number>();
  for (const shard of shards)
    for (const file of shard) counts.set(file, (counts.get(file) ?? 0) + 1);
  const expectedFiles = new Set(expected);
  const missing = expected.filter((file) => !counts.has(file));
  const duplicates = [...counts].filter(([, count]) => count !== 1);
  const unexpected = [...counts.keys()].filter(
    (file) => !expectedFiles.has(file),
  );
  if (missing.length || duplicates.length || unexpected.length)
    throw new Error(
      `Test shards must run every source test file exactly once. Missing: ${JSON.stringify(missing)}; duplicates: ${JSON.stringify(duplicates)}; unexpected: ${JSON.stringify(unexpected)}. Inspect the shard timing artifacts before rerunning CI.`,
    );
}

if (import.meta.main) {
  const directory = process.argv[2];
  const count = Number(process.argv[3]);
  if (!directory || !Number.isSafeInteger(count) || count < 1)
    throw new Error(
      "Usage: bun scripts/verify-test-shards.ts <artifact-directory> <shard-count>",
    );
  const manifests = await Array.fromAsync(
    new Glob("**/timings.json").scan({ cwd: directory }),
  );
  if (manifests.length !== count)
    throw new Error(
      `Expected ${count} shard manifests, received ${manifests.length}. Check failed or missing artifact uploads.`,
    );
  const shards = await Promise.all(
    manifests.map(async (path) => {
      const timings = timingsSchema.parse(
        await Bun.file(`${directory}/${path}`).json(),
      );
      return Object.keys(timings.files);
    }),
  );
  // These are Bun's supported test filename suffixes. Keep discovery independent
  // of the historical durations, so newly added tests cannot silently disappear.
  const expected = await Array.fromAsync(
    new Glob("**/*{.test,.spec,_test,_spec}.{js,jsx,ts,tsx}").scan({
      cwd: "src",
    }),
    (path) => `src/${path}`,
  );
  verifyTestShards(expected, shards);
  console.log(
    `Verified ${expected.length} source test files exactly once across ${count} shards.`,
  );
}
