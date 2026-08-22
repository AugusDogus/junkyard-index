import { describe, expect, test } from "bun:test";
import { escapeHtml } from "./html";

describe("escapeHtml", () => {
  test("escapes all five characters", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#039;",
    );
  });

  test("leaves safe text untouched", () => {
    expect(escapeHtml("Ace Auto Salvage")).toBe("Ace Auto Salvage");
  });

  test("handles empty input", () => {
    expect(escapeHtml("")).toBe("");
  });
});
