import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  parseWeberbrothersDetail,
  type WeberbrothersPost,
} from "./weberbrothers-parser";
import { transformWeberbrothersRecord } from "./weberbrothers-transform";
// Unmodified public HTTP response bodies captured 2026-11-15 UTC. Compression
// preserves the malformed Product JSON-LD, nested parts and actual native HTML.
const fixtures: {
  file: string;
  post: WeberbrothersPost;
  vin: string;
  status: "available" | "rejected";
}[] = [
  {
    file: "murano.html.gz",
    post: {
      url: "https://www.weberbrothersauto.com/product/2025-nissan-murano-b2b370/",
      title: "2025 NISSAN MURANO SV",
      stock: "B2B370",
      nativePostId: "1908003",
    },
    vin: "5N1AZ3BS4SC111240",
    status: "available",
  },
  {
    file: "malformed-year.html.gz",
    post: {
      url: "https://www.weberbrothersauto.com/product/2025-mazda-cx-90-b2a362/",
      title: "20225 MAZDA CX-90 PREFERRED",
      stock: "B2A362",
      nativePostId: "1906500",
    },
    vin: "JM3KKBHD6S1200827",
    status: "rejected",
  },
  {
    file: "simple-product.html.gz",
    post: {
      url: "https://www.weberbrothersauto.com/product/2025-volkswagen-tiguan-b2a194/",
      title: "2025 VOLKSWAGEN TIGUAN S",
      stock: "B2A194",
      nativePostId: "1838106",
    },
    vin: "3VVCR7RM0SM069967",
    status: "available",
  },
];
for (const fixture of fixtures)
  test("real native response: " + fixture.file, () => {
    const html = new TextDecoder("utf-8", { fatal: true }).decode(
      gunzipSync(
        readFileSync(
          new URL(
            "./weberbrothers-test-fixtures/" + fixture.file,
            import.meta.url,
          ),
        ),
      ),
    );
    const record = parseWeberbrothersDetail(html, fixture.post);
    expect(record.fields.VIN).toBe(fixture.vin);
    const result = transformWeberbrothersRecord(record);
    expect(result.status).toBe(fixture.status);
    if (result.status === "available")
      expect(result.vehicle.vin).toBe(fixture.vin);
    else expect(result.observedVins).toEqual([fixture.vin]);
  });
