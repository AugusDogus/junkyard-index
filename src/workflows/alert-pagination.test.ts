import { expect, test } from "bun:test";

// Fresh processes isolate Workflow/module mocks from the rest of the suite.
test.each([false, true])(
  "alert pagination checkpoints only after a stable scan (control=%j)",
  (stable) => {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "src/workflows/alert-pagination-test-fixture.ts",
        ...(stable ? ["--stable"] : []),
      ],
      { cwd: process.cwd() },
    );
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  },
);

test("the search lock stays held across awaits and releases when an action fails", () => {
  const script = `
 import { expect, mock } from 'bun:test';
 globalThis.fetch = async () => { throw new Error('Live network forbidden'); };
 let held = false;
 mock.module('workflow', () => ({
  createHook: () => {
   held = true;
   return { getConflict: async () => null, [Symbol.dispose]() { held = false; } };
  },
  sleep: async () => { throw new Error('An uncontended lock must not wait'); },
 }));
 const { withSearchWriteLock } = await import('./src/workflows/search-write-lock');
 await expect(withSearchWriteLock(async () => {
  await Promise.resolve();
  expect(held).toBe(true);
  throw new Error('fixture failure');
 })).rejects.toThrow('fixture failure');
 expect(held).toBe(false);
 expect(await withSearchWriteLock(async () => {
  await Promise.resolve();
  expect(held).toBe(true);
  return 'stopped';
 })).toBe('stopped');
 expect(held).toBe(false);
 `;
  const result = Bun.spawnSync([process.execPath, "--eval", script], {
    cwd: process.cwd(),
  });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
});
