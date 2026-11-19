import { onTestFinished } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, BrowserContextOptions, Page } from "playwright-core";

const recordings = new WeakMap<Page, string>();

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
  // A Bun timeout can finish the test before its finally block runs.
  onTestFinished(async () => {
    if (!page.isClosed()) await closePage(page);
  });
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
