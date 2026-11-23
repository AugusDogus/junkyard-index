import { describe, expect, test } from "bun:test";
import { SourceControl } from "./source-control";

const at = new Date("2026-11-22T12:00:00Z");

describe("SourceControl", () => {
  test("a source without a row runs and is shown", () => {
    expect(SourceControl.initial("pyp")).toEqual({
      source: "pyp",
      ingestion: "running",
      visibility: { status: "shown" },
      lastChange: null,
    });
  });

  test("reads stored rows, skipping sources the registry no longer has", () => {
    const controls = SourceControl.fromRows([
      {
        source: "meeks",
        ingestion: "running",
        visibility: "hidden",
        hiddenReason: "Hacked site",
        updatedByUserId: null,
        updatedAt: at,
      },
      {
        source: "pratt",
        ingestion: "paused",
        visibility: "shown",
        hiddenReason: null,
        updatedByUserId: "owner",
        updatedAt: at,
      },
      {
        source: "gone",
        ingestion: "paused",
        visibility: "shown",
        hiddenReason: null,
        updatedByUserId: "owner",
        updatedAt: at,
      },
    ]);
    expect([...controls.keys()].sort()).toEqual(["meeks", "pratt"]);
    expect(controls.get("meeks")).toEqual({
      source: "meeks",
      ingestion: "running",
      visibility: { status: "hidden", reason: "Hacked site" },
      lastChange: { at, byUserId: null },
    });
    expect(controls.get("pratt")?.ingestion).toBe("paused");
  });

  test("a hidden row without a reason is a stored-data error, named plainly", () => {
    expect(() =>
      SourceControl.fromRows([
        {
          source: "meeks",
          ingestion: "running",
          visibility: "hidden",
          hiddenReason: " ",
          updatedByUserId: null,
          updatedAt: at,
        },
      ]),
    ).toThrow(/source_control row for "meeks" is hidden without a reason/);
  });

  test("applies each change and says whether it changed anything", () => {
    const shown = SourceControl.initial("pratt");
    const paused = SourceControl.apply(shown, { kind: "pause" });
    expect(paused).toEqual({
      status: "changed",
      control: { ...shown, ingestion: "paused" },
    });
    expect(SourceControl.apply(paused.control, { kind: "pause" })).toEqual({
      status: "unchanged",
      control: paused.control,
    });
    expect(
      SourceControl.apply(paused.control, { kind: "resume" }).control.ingestion,
    ).toBe("running");

    const hidden = SourceControl.apply(shown, {
      kind: "hide",
      reason: "Hacked",
    });
    expect(hidden.status).toBe("changed");
    expect(hidden.control.visibility).toEqual({
      status: "hidden",
      reason: "Hacked",
    });
    // A new reason for a hidden source is a change, so it is logged.
    expect(
      SourceControl.apply(hidden.control, { kind: "hide", reason: "Hacked" })
        .status,
    ).toBe("unchanged");
    expect(
      SourceControl.apply(hidden.control, {
        kind: "hide",
        reason: "Still hacked",
      }).status,
    ).toBe("changed");
    expect(SourceControl.apply(hidden.control, { kind: "show" })).toEqual({
      status: "changed",
      control: { ...hidden.control, visibility: { status: "shown" } },
    });
    expect(SourceControl.apply(shown, { kind: "show" }).status).toBe(
      "unchanged",
    );
  });

  test("ingestion is paused when the owner or the Vercel flag says so", () => {
    expect(SourceControl.pauseCause("running", "on")).toBeNull();
    expect(SourceControl.pauseCause("running", "unknown")).toBeNull();
    expect(SourceControl.pauseCause("paused", "on")).toBe("admin");
    expect(SourceControl.pauseCause("running", "off")).toBe("flag");
    expect(SourceControl.pauseCause("paused", "off")).toBe("admin_and_flag");
  });

  test("the sources ingestion may run are flag-enabled and not paused here", () => {
    const controls = SourceControl.fromRows([
      {
        source: "pratt",
        ingestion: "paused",
        visibility: "shown",
        hiddenReason: null,
        updatedByUserId: "owner",
        updatedAt: at,
      },
      {
        source: "meeks",
        ingestion: "running",
        visibility: "hidden",
        hiddenReason: "Hacked",
        updatedByUserId: null,
        updatedAt: at,
      },
    ]);
    expect(SourceControl.runnable(["pyp", "pratt", "meeks"], controls)).toEqual(
      ["pyp", "meeks"],
    );
  });
});
