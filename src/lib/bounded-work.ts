/** How work that was given a time bound ended. */
export type BoundedWork<Value> =
  | { status: "done"; value: Value }
  | { status: "failed"; error: unknown }
  | { status: "timed-out" };

export const BoundedWork = {
  /**
   * Waits up to `ms` for `work`, never throwing. Work still running at the
   * bound keeps running; a failure after that is dropped, not left as an
   * unhandled rejection. For optional work, such as a deploy's warm-up,
   * that must neither fail nor stall what follows.
   */
  async settle<Value>(
    work: Promise<Value>,
    ms: number,
  ): Promise<BoundedWork<Value>> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work.then(
          (value): BoundedWork<Value> => ({ status: "done", value }),
          (error: unknown): BoundedWork<Value> => ({ status: "failed", error }),
        ),
        new Promise<BoundedWork<Value>>((resolve) => {
          timer = setTimeout(() => resolve({ status: "timed-out" }), ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  },
} as const;
