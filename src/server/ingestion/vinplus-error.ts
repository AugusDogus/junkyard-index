export interface VinplusError {
  tag: "VinplusError";
  operation: string;
  message: string;
}
export const VinplusError = {
  create(operation: string, detail: string): VinplusError {
    return {
      tag: "VinplusError",
      operation,
      message: `VinPlus ${operation}: ${detail}. Prior inventory is preserved. Inspect the public app evidence and resume from the last validated checkpoint.`,
    };
  },
} as const;
