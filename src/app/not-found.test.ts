import { expect, test } from "bun:test";
import { notFoundMetadata, rootMetadata } from "./root-metadata";

// Next adds <meta name="robots" content="noindex"> to every 404 itself, so
// the page must clear the layout's "index, follow" instead of adding its own.
test("404 pages drop the layout's indexable robots metadata", () => {
  expect(rootMetadata.robots).toMatchObject({ index: true });
  expect("robots" in notFoundMetadata).toBe(true);
  expect(notFoundMetadata.robots).toBeNull();
});
