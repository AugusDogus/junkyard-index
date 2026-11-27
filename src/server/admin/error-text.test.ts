import { describe, expect, test } from "bun:test";
import { ErrorText } from "./error-text";

const chunkFailure = (detail: string) =>
  `pratt ingestion failed: Step "step//./src/workflows/vehicle-steps//runDurableSourceChunkStep" failed after 2 retries: Vehicle source chunk pratt/{"source":"pratt","cursor":{"page":2},"phase":"owner"} failed: ${detail}`;

describe("ErrorText.messages", () => {
  test("reads a stored JSON array of strings", () => {
    expect(ErrorText.messages(JSON.stringify(["first", "second"]))).toEqual([
      "first",
      "second",
    ]);
  });

  test("keeps text that is not a JSON array as one message", () => {
    expect(ErrorText.messages("plain failure")).toEqual(["plain failure"]);
    expect(ErrorText.messages('{"not":"a list"}')).toEqual([
      '{"not":"a list"}',
    ]);
    expect(ErrorText.messages(JSON.stringify([1, "two"]))).toEqual([
      '[1,"two"]',
    ]);
  });

  test("recovers the first message of a cut-off array", () => {
    expect(
      ErrorText.messages(JSON.stringify(["abcdefghij", "next"]).slice(0, 7)),
    ).toEqual(["abcde"]);
    // Cut inside an escape: the half escape is dropped.
    expect(
      ErrorText.messages(JSON.stringify(['say "hi"']).slice(0, 7)),
    ).toEqual(["say "]);
  });

  test("has no messages for no text", () => {
    expect(ErrorText.messages(null)).toEqual([]);
    expect(ErrorText.messages("  ")).toEqual([]);
    expect(ErrorText.messages("[]")).toEqual([]);
  });
});

describe("ErrorText.core", () => {
  test("drops the workflow step and chunk wrapper around the cause", () => {
    expect(ErrorText.core(chunkFailure("Pratt request failed."))).toBe(
      "Pratt request failed.",
    );
  });

  test("drops the chunk wrapper and the cursor after the cause", () => {
    expect(
      ErrorText.core(
        `beavers ingestion failed: Step "step//./src/workflows/vehicle-steps//runDurableSourceChunkStep" failed after 2 retries: Vehicle source chunk beavers failed: Beaver's request failed.\nCursor: {"source":"beavers","phase":"route"}`,
      ),
    ).toBe("Beaver's request failed.");
    // An excerpt cut inside the cursor still yields the whole cause.
    expect(
      ErrorText.core(
        'Vehicle source chunk beavers failed: Beaver\'s request failed.\nCursor: {"source":"bea',
      ),
    ).toBe("Beaver's request failed.");
  });

  test("reads the message of a tagged error object", () => {
    expect(
      ErrorText.core(
        '{"tag":"AlliedError","operation":"coverage","message":"Allied coverage: model has no donors"}',
      ),
    ).toBe("Allied coverage: model has no donors");
  });

  test("reads the message of a cut-off tagged error object", () => {
    expect(
      ErrorText.core('{"tag":"AlliedError","message":"Allied coverage: mod'),
    ).toBe("Allied coverage: mod");
  });

  test("does not show a chunk cursor cut off before its cause", () => {
    expect(ErrorText.core(chunkFailure("Late cause").slice(0, 150))).toBe(
      "A step of the run failed. The cause is in the full error text.",
    );
  });

  test("leaves other text alone", () => {
    expect(ErrorText.core("Dutcher census does not reconcile.")).toBe(
      "Dutcher census does not reconcile.",
    );
  });
});

describe("ErrorText.summary", () => {
  test("names a slow website", () => {
    expect(
      ErrorText.summary([chunkFailure("City Motors timed out after 20000ms")]),
    ).toBe("The yard's website was too slow to answer in time.");
    expect(
      ErrorText.summary([
        "All-N-1 page budget: Three-minute chunk deadline exceeded",
      ]),
    ).toBe("The yard's website was too slow to answer in time.");
  });

  test("names a blocked request", () => {
    expect(ErrorText.summary(["Fetch returned HTTP 403 Forbidden"])).toBe(
      "The yard's website blocked or limited our requests.",
    );
  });

  test("names a run that found nothing", () => {
    expect(
      ErrorText.summary([
        "meeks did not provide terminal cursor evidence",
        "meeks produced 0 unique vehicles; minimum is 471",
      ]),
    ).toBe("The run found no vehicles, fewer than the 471 expected.");
  });

  test("names a drop too large to trust", () => {
    expect(
      ErrorText.summary([
        "meeks inventory fell from 1468 to 12, below the 50% drift limit",
      ]),
    ).toBe("The vehicle count fell from 1,468 to 12, too big a drop to trust.");
  });

  test("names a website that no longer matches the checks", () => {
    expect(
      ErrorText.summary([
        "Central https://example.com: Closing Central make graph changed; preserve prior inventory.",
      ]),
    ).toBe(
      "The yard's website did not look the way our checks expect. It may have changed.",
    );
  });

  test("falls back to the first sentence of the first message", () => {
    expect(
      ErrorText.summary([
        chunkFailure("Something odd happened here. More detail follows."),
      ]),
    ).toBe("Something odd happened here.");
  });

  test("shortens a long fallback", () => {
    const summary = ErrorText.summary(["x".repeat(500)]);
    expect(summary?.length).toBe(160);
    expect(summary?.endsWith("...")).toBe(true);
  });

  test("has no summary without messages", () => {
    expect(ErrorText.summary([])).toBeNull();
  });
});
