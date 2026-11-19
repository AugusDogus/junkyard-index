import { expect, test } from "bun:test";

test.each([
  { status: "unavailable", accepted: 0 },
  { status: "complete", accepted: 1 },
])(
  "the workflow warms before locking and reprojects new identities: %j",
  ({ status, accepted }) => {
    // Isolate workflow mocks so other tests keep the real step implementations.
    const script = `
    import { mock } from 'bun:test';
    let writer = false;
    const events = [];
    mock.module('workflow', () => ({
      sleep: async () => {},
      createHook: ({token}) => {
        if (token === 'algolia-writes') { writer = true; events.push('lock'); }
        return { getConflict: async () => null, [Symbol.dispose]() { if (token === 'algolia-writes') writer = false; } };
      },
    }));
    mock.module('./src/workflows/search-projector-steps', () => ({
      searchRebuildInFlightStep: async () => false,
    }));
    mock.module('./src/workflows/vehicle-steps', () => ({
      warmVinCacheBatchStep: async state => { if(writer) throw new Error('vPIC called under writer lock'); events.push('decode'); return {status:'${status}',state:{...state,accepted:${accepted}}}; },
      initializeSearchIndexMigrationStep: async force => { if (force !== ${accepted > 0}) throw new Error('new cached identities must trigger projection'); events.push('initialize'); return {status:'pending',state:{}}; },
      runSearchIndexMigrationBatchStep: async state => { if(!writer) throw new Error('publication lacks writer lock'); events.push('project'); return {done:true,state}; },
      finalizeSearchIndexMigrationStep: async () => { events.push('finalize'); return {}; },
    }));
    const {searchIndexMigrationWorkflow} = await import('./src/workflows/search-index-migration');
    await searchIndexMigrationWorkflow();
    console.log(JSON.stringify(events));
  `;
    const result = Bun.spawnSync([process.execPath, "--eval", script], {
      cwd: process.cwd(),
    });
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual([
      "decode",
      "lock",
      "initialize",
      "project",
      "finalize",
    ]);
  },
);
