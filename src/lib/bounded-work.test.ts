import { expect, test } from "bun:test";
import { BoundedWork } from "./bounded-work";

test("returns the work's value when it finishes in time", async () => {
  expect(await BoundedWork.settle(Promise.resolve(3), 1_000)).toEqual({
    status: "done",
    value: 3,
  });
});

test("returns a failure as a value instead of throwing", async () => {
  const error = new Error("no such table: yard_summary");
  expect(await BoundedWork.settle(Promise.reject(error), 1_000)).toEqual({
    status: "failed",
    error,
  });
});

test("stops waiting after the bound, and a later failure goes nowhere", async () => {
  let fail: (error: Error) => void = () => undefined;
  const work = new Promise<number>((_, reject) => {
    fail = reject;
  });

  expect(await BoundedWork.settle(work, 10)).toEqual({ status: "timed-out" });
  // Would be an unhandled rejection, failing the process, if nothing caught it.
  fail(new Error("client closed"));
  await new Promise((resolve) => setTimeout(resolve, 10));
});
