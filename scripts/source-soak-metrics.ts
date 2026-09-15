import { AsyncLocalStorage } from "node:async_hooks";
import { Effect, Scheduler } from "effect";
import type { IngestionSource } from "../src/lib/ingestion-source";

interface RequestMetrics {
  requests: number;
  statuses: Map<number, number>;
  networkErrors: number;
}

/** Fetch instrumentation for the read-only source soak, never production ingestion. */
export class SourceSoakMetrics {
  private readonly sourceContext = new AsyncLocalStorage<IngestionSource>();
  private readonly requestMetrics = new Map<IngestionSource, RequestMetrics>();

  metricsFor(source: IngestionSource): RequestMetrics {
    const existing = this.requestMetrics.get(source);
    if (existing) return existing;
    const created: RequestMetrics = {
      requests: 0,
      statuses: new Map(),
      networkErrors: 0,
    };
    this.requestMetrics.set(source, created);
    return created;
  }

  runPromise<A, E>(
    source: IngestionSource,
    program: Effect.Effect<A, E>,
  ): Promise<A> {
    // Effect batches fibers from different sources in one scheduler callback.
    // Re-enter the owning source for every task, not just the initial runPromise.
    // Child fibers inherit this scheduler; async fetch continuations inherit ALS.
    const scheduler = Scheduler.make((task, priority) => {
      Scheduler.defaultScheduler.scheduleTask(
        () => this.sourceContext.run(source, task),
        priority,
      );
    });
    return this.sourceContext.run(source, () =>
      Effect.runPromise(Effect.withScheduler(program, scheduler)),
    );
  }

  installFetchMetrics(): () => void {
    const originalFetch = globalThis.fetch;
    const trackedFetch = Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        const source = this.sourceContext.getStore();
        if (!source) return originalFetch(...args);

        const metrics = this.metricsFor(source);
        metrics.requests += 1;
        try {
          const response = await originalFetch(...args);
          metrics.statuses.set(
            response.status,
            (metrics.statuses.get(response.status) ?? 0) + 1,
          );
          return response;
        } catch (error) {
          metrics.networkErrors += 1;
          throw error;
        }
      },
      { preconnect: originalFetch.preconnect },
    );
    globalThis.fetch = trackedFetch;
    return () => {
      globalThis.fetch = originalFetch;
    };
  }
}
