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

test("an alert check batch waiting behind a search index writer stays live", () => {
  const script = `
 import { expect, mock } from 'bun:test';
 globalThis.fetch = async () => { throw new Error('Live network forbidden'); };
 const events = [];
 let contended = 3;
 mock.module('workflow', () => ({
  getWorkflowMetadata: () => ({ workflowRunId: 'fixture' }),
  createHook: ({ token }) => ({
   getConflict: async () =>
    token === 'algolia-writes' && contended-- > 0 ? { runId: 'migration' } : null,
   [Symbol.dispose]() {},
  }),
  sleep: async (delay) => { events.push('sleep ' + delay); },
 }));
 mock.module('workflow/api', () => ({ start: async () => ({ runId: 'unused' }), getRun: () => ({}) }));
 mock.module('./src/server/alerts/durable-alert-delivery-runtime', () => ({
  hasDeliverableNotificationIntents: async () => false,
 }));
 mock.module('./src/server/alerts/search-alert-check-runtime', () => ({
  openDailySearchAlertCheck: async () => 'running',
  searchAlertsEnabled: async () => true,
 }));
 mock.module('./src/server/ingestion/durable-ingestion', () => ({
  getAttachedIngestionWorkflowRuns: async () => [],
  swapDurableIngestionWorkflowRun: async () => true,
 }));
 mock.module('./src/workflows/downstream-consumers', () => ({
  vehicleNotificationDeliveryWorkflow: async () => {},
 }));
 mock.module('./src/workflows/search-projector', () => ({
  searchProjectorWorkflow: async () => {},
 }));
 const unused = async () => { throw new Error('unused step'); };
 mock.module('./src/workflows/vehicle-steps', () => ({
  ...Object.fromEntries([
   'cleanupDurableIngestionStateBatchStep', 'cleanupStaleDurableAlgoliaRebuildsStep',
   'attachDurableIngestionWorkflowStep', 'claimDurableIngestionCommitStep',
   'detachDurableIngestionWorkflowStep',
   'prepareIngestionPassStep', 'reportIngestionRunStep', 'signalCommitWaitersStep',
   'initializeDurableIngestionStep', 'markDurableIngestionFailedStep',
   'markDurableSourceFailedStep', 'reportProviderStatusStep',
   'reconcileDurableIngestionStep', 'runAlgoliaProjectorStep',
   'runDurableSourceChunkStep', 'validateDurableIngestionSourcesStep',
  ].map((name) => [name, unused])),
  touchSearchAlertCheckStep: async (day) => { events.push('heartbeat ' + day); },
  runSearchAlertCheckBatchStep: async () => {
   events.push('batch');
   return { status: 'complete', checkId: 'check', searchesProcessed: 1, intentsCreated: 0 };
  },
 }));
 const { searchAlertCheckWorkflow } = await import('./src/workflows/vehicle-ingestion');
 expect(await searchAlertCheckWorkflow('2026-11-21')).toMatchObject({ status: 'completed' });
 console.log(JSON.stringify(events));
 `;
  const result = Bun.spawnSync([process.execPath, "--eval", script], {
    cwd: process.cwd(),
  });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  // The workflow also logs each wait; the events are the last line.
  const events = result.stdout.toString().trim().split("\n").at(-1) ?? "";
  expect(JSON.parse(events)).toEqual([
    "heartbeat 2026-11-21",
    "sleep 30s",
    "heartbeat 2026-11-21",
    "sleep 30s",
    "heartbeat 2026-11-21",
    "sleep 30s",
    "batch",
  ]);
});
