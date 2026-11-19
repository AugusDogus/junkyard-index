import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from "playwright-core";

const recordings = new WeakMap<Page, string>();

export function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    // Preserve raw traces and frame screenshots even if Bun kills Chromium on
    // a test timeout, before the test's finally block can export its ZIP.
    tracesDir: process.env.BROWSER_TEST_ARTIFACTS,
  });
}

export async function createPage(
  browser: Browser,
  options?: BrowserContextOptions,
): Promise<Page> {
  const page = await browser.newPage(options);
  const directory = process.env.BROWSER_TEST_ARTIFACTS;
  if (directory) {
    await mkdir(directory, { recursive: true });
    recordings.set(page, join(directory, randomUUID()));
    await page.context().tracing.start({
      screenshots: true,
      snapshots: true,
      sources: true,
    });
  }
  return page;
}

// Tests close pages in finally blocks, before Bun reports their outcome. Record
// every page here; CI uploads these diagnostics only when the shard fails.
export async function closePage(page: Page): Promise<void> {
  try {
    const path = recordings.get(page);
    if (path) {
      recordings.delete(page);
      try {
        await page.screenshot({ path: `${path}.png` });
      } finally {
        await page.context().tracing.stop({ path: `${path}.zip` });
      }
    }
  } finally {
    await page.close();
  }
}
