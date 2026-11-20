import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../drizzle");

const journalSchema = z.object({
  entries: z.array(
    z.object({ idx: z.number(), when: z.number(), tag: z.string() }),
  ),
});
const snapshotSchema = z.object({ id: z.string(), prevId: z.string() });

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(join(MIGRATIONS_FOLDER, path), "utf8"));
}

/**
 * The libSQL migrator applies a journal entry only when its `when` is later
 * than the newest migration the database already applied, and skips it
 * silently otherwise. Branches that each generate a migration can merge with
 * a `when` that goes backwards, so production would never run it. This test
 * fails the merge instead. Fix it by renumbering the later branch's migration
 * after the other and giving it a later `when`.
 */
test("migration journal entries, files and snapshots form one ordered chain", async () => {
  const { entries } = journalSchema.parse(await readJson("meta/_journal.json"));
  const problems: string[] = [];

  entries.forEach((entry, position) => {
    if (entry.idx !== position) {
      problems.push(
        `${entry.tag}: idx ${entry.idx} is at position ${position}`,
      );
    }
    if (!entry.tag.startsWith(`${String(entry.idx).padStart(4, "0")}_`)) {
      problems.push(`${entry.tag}: tag does not start with its idx`);
    }
    const previous = entries[position - 1];
    if (previous && entry.when <= previous.when) {
      problems.push(
        `${entry.tag}: when ${entry.when} is not after ${previous.tag}'s ${previous.when}`,
      );
    }
  });

  const sqlFiles = (await readdir(MIGRATIONS_FOLDER))
    .filter((name) => name.endsWith(".sql"))
    .map((name) => name.slice(0, -".sql".length));
  const tags = new Set(entries.map((entry) => entry.tag));
  for (const file of sqlFiles) {
    if (!tags.has(file)) problems.push(`${file}.sql is not in the journal`);
  }
  for (const tag of tags) {
    if (!sqlFiles.includes(tag)) problems.push(`${tag}: ${tag}.sql is missing`);
  }

  let previousId: string | undefined;
  for (const entry of entries) {
    const snapshotPath = `meta/${String(entry.idx).padStart(4, "0")}_snapshot.json`;
    const snapshot = snapshotSchema.parse(await readJson(snapshotPath));
    if (previousId !== undefined && snapshot.prevId !== previousId) {
      problems.push(
        `${snapshotPath}: prevId ${snapshot.prevId} is not the previous snapshot's id ${previousId}`,
      );
    }
    previousId = snapshot.id;
  }

  expect(problems).toEqual([]);
});
