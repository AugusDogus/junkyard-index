import { z } from "zod";
import { kandrHash } from "./kandr-native";
import { KANDR_YARD } from "./kandr-snapshot";

// Complete saved census: 48 accepted donors of 49, November 15, 2026 UTC.
export const KANDR_MINIMUM_UNIQUE_INVENTORY = 16;
export const KandrContractSchema = z
  .object({
    minimumUniqueInventory: z.number().int().positive().safe(),
  })
  .strict();
export type KandrContract = z.infer<typeof KandrContractSchema>;
export interface KandrError {
  tag: "KandrError";
  operation: string;
  message: string;
  /** The underlying failure, kept so the workflow can recognise a cooldown. */
  cause?: unknown;
}
export type KandrResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: KandrError };
export const KandrError = {
  create(operation: string, detail: string, cause?: unknown): KandrError {
    return {
      tag: "KandrError",
      operation,
      message: `K&R ${operation}: ${detail}. Prior inventory is preserved; inspect the evidence before resuming the last validated checkpoint.`,
      ...(cause === undefined ? {} : { cause }),
    };
  },
} as const;
export function kandrBoundary<T>(
  operation: string,
  run: () => T,
): KandrResult<T> {
  try {
    return { ok: true, value: run() };
  } catch (cause) {
    return {
      ok: false,
      error: KandrError.create(
        operation,
        cause instanceof Error ? cause.message : String(cause),
      ),
    };
  }
}
export const kandrScope = (contract: KandrContract) =>
  kandrHash({
    contract: KandrContractSchema.parse(contract),
    yard: KANDR_YARD,
    supplier: "6483483/1",
    protocol: 1,
  });
export const KandrContract = {
  parse(input: unknown) {
    return kandrBoundary("qualification contract", () =>
      KandrContractSchema.parse(input),
    );
  },
} as const;
