import { describe, expect, test } from "bun:test";
import { classifyDurableAlertRun } from "./durable-alert-run-state";

describe("durable alert run replay state", () => {
  test("recognizes a released run before applying the active-run fence", () => {
    expect(
      classifyDurableAlertRun({
        status: "success",
        stage: "released",
        activeSlot: null,
        publicationSequence: 7,
      }),
    ).toEqual({ status: "complete" });
  });

  test("stops abandoned runs and accepts an active matching run", () => {
    expect(
      classifyDurableAlertRun({
        status: "abandoned",
        stage: "match_alerts",
        activeSlot: null,
        publicationSequence: 7,
      }),
    ).toEqual({ status: "stopped" });
    expect(
      classifyDurableAlertRun({
        status: "running",
        stage: "match_alerts",
        activeSlot: 1,
        publicationSequence: 7,
      }),
    ).toEqual({ status: "ready", publicationSequence: 7 });
  });
});
