import { expect, test } from "bun:test";
import { cn } from "./utils";

test("keeps a theme size role beside a colour", () => {
  expect(cn("text-figure text-title")).toBe("text-figure text-title");
  expect(cn("text-ink-2", "text-section")).toBe("text-ink-2 text-section");
});

test("a later theme size role replaces an earlier size", () => {
  expect(cn("text-sm", "text-lead")).toBe("text-lead");
  expect(cn("text-display-s", "text-2xl")).toBe("text-2xl");
});

test("a later colour still replaces an earlier colour", () => {
  expect(cn("text-ink-2", "text-board-muted")).toBe("text-board-muted");
});
