// Pure constants: cursor modules are also imported by Vercel Workflow.
export const HOLLANDERSTORES_MAX_BODY_BYTES = 40 * 1024 * 1024;
// Two complete Stricker card rosters measured 47,899,239 bytes. Its list
// alternative needs 1,246 requests per census and omits native makes.
export const hollanderstoresBodyLimit = (code: string) =>
  code === "strickerauto" ? 50 * 1024 * 1024 : HOLLANDERSTORES_MAX_BODY_BYTES;
export const HOLLANDERSTORES_MAX_YARD_ROWS = 25_000;
export const HOLLANDERSTORES_MAX_ROWS = 100_000;
export const HOLLANDERSTORES_MAX_REQUESTS = 5_000;
export const HOLLANDERSTORES_MAX_CURSOR_BYTES = 32 * 1024 * 1024;
