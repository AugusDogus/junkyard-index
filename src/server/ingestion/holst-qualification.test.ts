import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { parseTruckPartsCatalogPage } from "./truck-parts-catalog";
import { parseRetryAfterMs } from "./provider-http-client";

const root = `${import.meta.dir}/holst-test-fixtures/rate-limit/`;
const receiptSchema = z.object({
  file: z.string(),
  status: z.number(),
  bytes: z.number(),
  sha256: z.string(),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  retryAfter: z.string().nullable(),
});
const read = (file: string): unknown =>
  JSON.parse(readFileSync(root + file, "utf8"));
const config = {
  origin: "https://holsttruck.com",
  listPath: "/trucks/",
  detailPath: "/truck-description/",
  photoAccount: "22216",
};
const body = (receipt: z.infer<typeof receiptSchema>) => {
  const bytes = gunzipSync(readFileSync(root + receipt.file));
  expect(bytes.length).toBe(receipt.bytes);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(receipt.sha256);
  return bytes.toString("utf8");
};

test("Holst still rate-limits ten-second serial reads with a five-minute Retry-After", () => {
  const receipts = z
    .array(receiptSchema)
    .length(20)
    .parse(read("requests.json"));
  for (const [index, receipt] of receipts.entries()) {
    const previous = receipts[index - 1];
    if (previous)
      expect(
        Date.parse(receipt.startedAt) - Date.parse(previous.completedAt),
      ).toBeGreaterThanOrEqual(10000);
    const raw = body(receipt);
    if (index < 19) {
      expect(receipt.status).toBe(200);
      const page = parseTruckPartsCatalogPage(raw, index + 1, config);
      expect(page.records).toHaveLength(25);
      expect(page.total).toBe(2374);
      expect(page.lastPage).toBe(95);
    } else {
      expect(receipt.status).toBe(429);
      expect(raw).toContain("limit the number of requests per minute");
      expect(
        parseRetryAfterMs(receipt.retryAfter, Date.parse(receipt.completedAt)),
      ).toBe(300000);
      expect(() => parseTruckPartsCatalogPage(raw, 20, config)).toThrow();
    }
  }
  const last = receipts.at(-1);
  if (!last) throw new Error("Missing Holst rate-limit response");
  const recovery = receiptSchema.parse(read("recovery.json"));
  expect(
    Date.parse(recovery.startedAt) - Date.parse(last.completedAt),
  ).toBeGreaterThanOrEqual(300000);
  expect(recovery.status).toBe(200);
  const page = parseTruckPartsCatalogPage(body(recovery), 20, config);
  expect(page.total).toBe(2374);
  expect(page.rangeEnd).toBe(500);
  expect(page.nextUrl).not.toBeNull();
});
