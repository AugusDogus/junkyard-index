import { expect, test } from "bun:test";
import { ProviderRequestError, RequestTimeoutError } from "./errors";
import {
  isTransientRequestFailure,
  transientStatusCause,
} from "./transient-request";

const context = "Yard https://yard.test/";
const timeout = new DOMException("The operation timed out.", "TimeoutError");

test("transport failures and 5xx answers are transient, even when wrapped", () => {
  for (const failure of [
    new ProviderRequestError({ context, cause: new TypeError("fetch failed") }),
    new Error("received 503", transientStatusCause(context, 503)),
    new Error("outer", {
      cause: new Error("received 500", transientStatusCause(context, 500)),
    }),
  ])
    expect(isTransientRequestFailure(failure, { timeouts: false })).toBe(true);
});

test("deadlines are transient only when the caller allows timeout retries", () => {
  for (const failure of [
    timeout,
    new RequestTimeoutError({ context, cause: "deadline" }),
    new Error("wrapped", { cause: timeout }),
  ]) {
    expect(isTransientRequestFailure(failure, { timeouts: true })).toBe(true);
    expect(isTransientRequestFailure(failure, { timeouts: false })).toBe(false);
  }
});

test("denials, redirects, decoding failures and interruptions are never transient", () => {
  for (const status of [301, 403, 404, 429, 501]) {
    expect(transientStatusCause(context, status)).toBeUndefined();
    expect(
      isTransientRequestFailure(
        new Error("received " + status, transientStatusCause(context, status)),
        { timeouts: true },
      ),
    ).toBe(false);
  }
  for (const failure of [
    new TypeError("The encoded data was not valid for encoding utf-8"),
    new DOMException("aborted", "AbortError"),
    new Error("received 206"),
    null,
    "outcome unknown",
  ])
    expect(isTransientRequestFailure(failure, { timeouts: true })).toBe(false);
});
