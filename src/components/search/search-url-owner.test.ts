import { expect, test } from "bun:test";
import { join, relative } from "node:path";

// nuqs strips its private `__nuqs__` marker from history writes it makes, and
// treats any other write as a navigation. A write passing the marker hides
// itself from nuqs; nuqs alone writes the /search URL.
test("nothing in src writes history with nuqs's private __nuqs__ marker", async () => {
  const root = join(import.meta.dir, "../..");
  const self = relative(root, import.meta.path);
  const marked: string[] = [];
  for await (const file of new Bun.Glob("**/*.{ts,tsx,js,jsx,mjs,cjs}").scan(
    root,
  )) {
    if (file === self) continue;
    if ((await Bun.file(join(root, file)).text()).includes("__nuqs__"))
      marked.push(file);
  }
  expect(marked).toEqual([]);
});
