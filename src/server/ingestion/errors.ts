import { Data } from "effect";

function getCauseMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export class IngestionLockError extends Data.TaggedError("IngestionLockError")<{
  runId: string;
  message: string;
}> {}

export class RetryableHttpStatusError extends Data.TaggedError(
  "RetryableHttpStatusError",
)<{
  context: string;
  status: number;
}> {
  override get message() {
    return `${this.context} returned retryable HTTP status ${this.status}`;
  }
}

export class RequestTimeoutError extends Data.TaggedError("RequestTimeoutError")<{
  context: string;
  cause: unknown;
}> {
  override get message() {
    return `${this.context} timed out: ${getCauseMessage(this.cause)}`;
  }
}

export class PypProviderError extends Data.TaggedError("PypProviderError")<{
  page: number;
  cause: unknown;
}> {
  override get message() {
    return `PYP page ${this.page}: ${getCauseMessage(this.cause)}`;
  }
}

export class Row52ProviderError extends Data.TaggedError(
  "Row52ProviderError",
)<{
  skip: number;
  cause: unknown;
}> {
  override get message() {
    return `Row52 at skip=${this.skip}: ${getCauseMessage(this.cause)}`;
  }
}

export class AutorecyclerProviderError extends Data.TaggedError(
  "AutorecyclerProviderError",
)<{
  from: number;
  cause: unknown;
}> {
  override get message() {
    return `AutoRecycler at from=${this.from}: ${getCauseMessage(this.cause)}`;
  }
}

export class PullapartProviderError extends Data.TaggedError(
  "PullapartProviderError",
)<{
  cursor: string;
  cause: unknown;
}> {
  override get message() {
    return `Pull-A-Part at ${this.cursor}: ${getCauseMessage(this.cause)}`;
  }
}

export class TapInventoryProviderError extends Data.TaggedError(
  "TapInventoryProviderError",
)<{
  cursor: string;
  cause: unknown;
}> {
  override get message() {
    return `TAP inventory at ${this.cursor}: ${getCauseMessage(this.cause)}`;
  }
}

export class BrowserSessionError extends Data.TaggedError(
  "BrowserSessionError",
)<{
  phase: "open" | "fetch" | "rotate" | "close";
  cause: unknown;
}> {
  override get message() {
    return `Browser session ${this.phase}: ${getCauseMessage(this.cause)}`;
  }
}

export class ReconcileError extends Data.TaggedError("ReconcileError")<{
  cause: unknown;
}> {
  override get message() {
    return `Reconcile failed: ${getCauseMessage(this.cause)}`;
  }
}

export class PersistenceError extends Data.TaggedError("PersistenceError")<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    return `Persistence ${this.operation}: ${getCauseMessage(this.cause)}`;
  }
}

export class HeartbeatError extends Data.TaggedError("HeartbeatError")<{
  cause: unknown;
}> {
  override get message() {
    return `Heartbeat failed: ${getCauseMessage(this.cause)}`;
  }
}

export type IngestionError =
  | IngestionLockError
  | RetryableHttpStatusError
  | RequestTimeoutError
  | PypProviderError
  | Row52ProviderError
  | AutorecyclerProviderError
  | PullapartProviderError
  | TapInventoryProviderError
  | BrowserSessionError
  | ReconcileError
  | PersistenceError
  | HeartbeatError;
