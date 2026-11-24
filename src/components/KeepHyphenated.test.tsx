import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { KeepHyphenated } from "./KeepHyphenated";

test("keeps hyphenated words whole and leaves spaces to wrap", () => {
  expect(
    renderToStaticMarkup(<KeepHyphenated text="Largest Pull-A-Part yards" />),
  ).toBe('Largest <span class="whitespace-nowrap">Pull-A-Part</span> yards');
  expect(renderToStaticMarkup(<KeepHyphenated text="Foss" />)).toBe("Foss");
});
