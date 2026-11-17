import { validationRejection } from "./ingestion-validation";
export interface AlliedError {
  tag: "AlliedError";
  operation: string;
  message: string;
}
export type AlliedResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AlliedError };
export const AlliedResult = {
  error(operation: string, detail: string): AlliedError {
    return {
      tag: "AlliedError",
      operation,
      message: `Allied ${operation}: ${detail}. Prior inventory is preserved; inspect the native evidence and resume from the last validated checkpoint.`,
    };
  },
  boundary<T>(operation: string, run: () => T): AlliedResult<T> {
    try {
      return { ok: true, value: run() };
    } catch (cause) {
      return {
        ok: false,
        error: validationRejection(
          AlliedResult.error(
            operation,
            cause instanceof Error ? cause.message : String(cause),
          ),
        ),
      };
    }
  },
} as const;
