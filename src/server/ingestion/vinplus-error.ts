export interface VinplusError {
  tag: "VinplusError";
  operation: string;
  message: string;
}
/** Impact of any rejection: VinPlus publishes all of its yards as one unit. */
export const VINPLUS_NOT_PUBLISHED =
  "VinPlus is not published this attempt and every VinPlus yard keeps its published inventory";
export const VinplusError = {
  create(operation: string, detail: string): VinplusError {
    return {
      tag: "VinplusError",
      operation,
      message: `VinPlus ${operation}: ${detail}. Prior inventory is preserved. Inspect the public app evidence and resume from the last validated checkpoint.`,
    };
  },
} as const;
