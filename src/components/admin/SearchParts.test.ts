import { describe, expect, test } from "bun:test";
import { alertCheckStatusText, publicationResultText } from "./SearchParts";

describe("publicationResultText", () => {
  test("a degraded single-source run kept that source's previous vehicles", () => {
    expect(
      publicationResultText({
        source: "upullrparts",
        inventoryOutcome: "published_degraded",
      }),
    ).toBe("Rejected, previous vehicles kept");
  });

  test("a degraded run of every source left some sources out", () => {
    expect(
      publicationResultText({
        source: "all",
        inventoryOutcome: "published_degraded",
      }),
    ).toBe("Some sources left out");
  });

  test("names published runs and shows unknown outcomes as stored", () => {
    expect(
      publicationResultText({ source: "pyp", inventoryOutcome: "published" }),
    ).toBe("Published");
    expect(
      publicationResultText({ source: "pyp", inventoryOutcome: "other" }),
    ).toBe("other");
    expect(
      publicationResultText({ source: "pyp", inventoryOutcome: null }),
    ).toBe("Unknown");
  });
});

describe("alertCheckStatusText", () => {
  test("says each check status in plain words", () => {
    expect(alertCheckStatusText("complete")).toBe("Finished");
    expect(alertCheckStatusText("running")).toBe("Running");
    expect(alertCheckStatusText("superseded")).toBe(
      "Replaced by a later check",
    );
    expect(alertCheckStatusText("paused")).toBe("paused");
  });
});
