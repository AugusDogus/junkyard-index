import { Data } from "effect";

export class IngestionLockError extends Data.TaggedError("IngestionLockError")<{
  runId: string;
  message: string;
}> {}

export class PypProviderError extends Data.TaggedError("PypProviderError")<{
  page: number;
  cause: unknown;
}> {
  override get message() {
    const inner =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `PYP page ${this.page}: ${inner}`;
  }
}

export class Row52ProviderError extends Data.TaggedError(
  "Row52ProviderError",
)<{
  skip: number;
  cause: unknown;
}> {
  override get message() {
    const inner =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Row52 at skip=${this.skip}: ${inner}`;
  }
}

export class BrowserSessionError extends Data.TaggedError(
  "BrowserSessionError",
)<{
  phase: "open" | "fetch" | "rotate" | "close";
  cause: unknown;
}> {
  override get message() {
    const inner =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Browser session ${this.phase}: ${inner}`;
  }
}

export class ReconcileError extends Data.TaggedError("ReconcileError")<{
  cause: unknown;
}> {
  override get message() {
    const inner =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Reconcile failed: ${inner}`;
  }
}

export class PersistenceError extends Data.TaggedError("PersistenceError")<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    const inner =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Persistence ${this.operation}: ${inner}`;
  }
}

export class HeartbeatError extends Data.TaggedError("HeartbeatError")<{
  cause: unknown;
}> {
  override get message() {
    const inner =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Heartbeat failed: ${inner}`;
  }
}

export type IngestionError =
  | IngestionLockError
  | PypProviderError
  | Row52ProviderError
  | BrowserSessionError
  | ReconcileError
  | PersistenceError
  | HeartbeatError;
