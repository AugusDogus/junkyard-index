import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");

// Each downstream consumer's entry points: its cron route and its workflow.
const CONSUMER_ENTRIES = {
  "inventory-downstream": [
    "src/app/api/cron/inventory-downstream/route.ts",
    "src/workflows/downstream-consumers.ts",
  ],
  maintenance: [
    "src/app/api/cron/ingestion-maintenance/route.ts",
    "src/workflows/downstream-consumers.ts",
  ],
  "notification-delivery": [
    "src/app/api/cron/notification-delivery/route.ts",
    "src/workflows/downstream-consumers.ts",
  ],
} as const;

const transpilers = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
  js: new Bun.Transpiler({ loader: "js" }),
};

function resolveLocal(specifier: string, importer: string): string | null {
  let base: string;
  if (specifier === "~/schema") base = join(ROOT, "schema");
  else if (specifier.startsWith("~/"))
    base = join(ROOT, "src", specifier.slice(2));
  else if (specifier.startsWith("."))
    base = resolve(dirname(importer), specifier);
  else return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    join(base, "index.ts"),
  ]) {
    if (existsSync(candidate) && /\.(ts|tsx|js|json)$/.test(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `Could not resolve ${specifier} from ${relative(ROOT, importer)}; teach this test the alias or extension.`,
  );
}

/** Every local module and package a set of entry files loads at runtime. */
function runtimeImports(entries: readonly string[]) {
  const modules = new Set<string>();
  const packages = new Set<string>();
  const pending = entries.map((entry) => join(ROOT, entry));
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || modules.has(file)) continue;
    modules.add(file);
    if (file.endsWith(".json")) continue;
    // Type-only imports are erased, so they are not followed.
    const transpiler = file.endsWith(".tsx")
      ? transpilers.tsx
      : file.endsWith(".js")
        ? transpilers.js
        : transpilers.ts;
    for (const { path } of transpiler.scanImports(readFileSync(file, "utf8"))) {
      const local = resolveLocal(path, file);
      if (local) pending.push(local);
      else packages.add(path);
    }
  }
  return {
    modules: [...modules].map((file) => relative(ROOT, file)),
    packages: [...packages],
  };
}

describe("downstream consumers never load a search backend", () => {
  for (const [consumer, entries] of Object.entries(CONSUMER_ENTRIES)) {
    test(consumer, () => {
      const { modules, packages } = runtimeImports(entries);
      expect(modules).toContain(entries[0]);
      expect(modules.filter((file) => /algolia|typesense/i.test(file))).toEqual(
        [],
      );
      expect(
        packages.filter((name) => /algolia|typesense/i.test(name)),
      ).toEqual([]);
    });
  }
});
