export const workflowStartRetryOptions = {
  retries: 2,
  factor: 2,
  minTimeout: 1_000,
  maxTimeout: 5_000,
  randomize: true,
} as const;
