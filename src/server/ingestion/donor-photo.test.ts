import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { DonorPhoto } from "./donor-photo";
import { donorPhotoResponse } from "./donor-photo-response";
import { DonorPhotoStore } from "./donor-photo-store";

const jpeg = await sharp({
  create: { width: 8, height: 8, channels: 3, background: "red" },
})
  .jpeg()
  .toBuffer();

test("preserves original JPEG bytes and serves them independently of their source", async () => {
  const store = DonorPhotoStore.memory();
  const sourceBytes = Buffer.from(jpeg);
  const hash = await store.save(sourceBytes);
  sourceBytes.fill(0);
  const response = await donorPhotoResponse(hash, store);
  expect(response.status).toBe(200);
  expect(Buffer.from(await response.arrayBuffer()).equals(jpeg)).toBe(true);
  expect(hash).toBe(createHash("sha256").update(jpeg).digest("hex"));
  expect(response.headers.get("content-type")).toBe("image/jpeg");
  expect(response.headers.get("cache-control")).toContain("immutable");
  expect(response.headers.get("etag")).toBe(`"${hash}"`);
  const loaded = await store.load(hash);
  loaded?.bytes.fill(0);
  expect((await store.load(hash))?.bytes).toEqual(jpeg);
});

test("invalid hashes never reach the store and absent photos return 404", async () => {
  let reads = 0;
  const store: DonorPhotoStore = {
    save: async () => {
      throw new Error("not used");
    },
    load: async () => {
      reads++;
      return null;
    },
  };
  for (const hash of ["../private", "", "F".repeat(64), "a".repeat(65)])
    expect((await donorPhotoResponse(hash, store)).status).toBe(404);
  expect(reads).toBe(0);
  expect((await donorPhotoResponse("a".repeat(64), store)).status).toBe(404);
  expect(reads).toBe(1);
});

test("unavailable storage never redirects to the provider or returns an image-shaped success", async () => {
  const response = await donorPhotoResponse("a".repeat(64), {
    save: async () => {
      throw new Error("not used");
    },
    load: async () => {
      throw new Error("offline");
    },
  });
  expect(response.status).toBe(503);
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("no-store");
});

test.each([
  Buffer.alloc(0),
  Buffer.from("<html>challenge</html>"),
  Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  jpeg.subarray(0, Math.floor(jpeg.length / 2)),
  Buffer.alloc(DonorPhoto.maximumBytes + 1),
])("rejects malformed, truncated and oversized photos", async (bytes) => {
  await expect(DonorPhoto.parse(bytes)).rejects.toThrow();
});

test("preserves native PNG bytes and serves their actual MIME", async () => {
  const png = await sharp(jpeg).png().toBuffer();
  const store = DonorPhotoStore.memory();
  const hash = await store.save(png);
  const response = await donorPhotoResponse(hash, store);
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(Buffer.from(await response.arrayBuffer()).equals(png)).toBe(true);
  expect(hash).toBe(createHash("sha256").update(png).digest("hex"));
  expect(
    (
      await DonorPhoto.read(
        new Response(new Uint8Array(png), {
          headers: { "content-type": "image/png" },
        }),
      )
    ).mime,
  ).toBe("image/png");
});

test("rejects unsupported formats and excessive JPEG dimensions", async () => {
  const webp = await sharp(jpeg).webp().toBuffer();
  await expect(DonorPhoto.parse(webp)).rejects.toThrow("JPEG or PNG");
  const large = await sharp({
    create: { width: 4001, height: 4000, channels: 3, background: "white" },
  })
    .jpeg()
    .toBuffer();
  await expect(DonorPhoto.parse(large)).rejects.toThrow();
});

test("bounds streamed bodies even when Content-Length is missing", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(1_000_001));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(
    DonorPhoto.read(
      new Response(stream, {
        headers: { "content-type": "image/jpeg" },
      }),
    ),
  ).rejects.toThrow("byte bound");
  expect(cancelled).toBe(true);
});

test("accepts a complete JPEG and rejects partial or misleading responses", async () => {
  const headers = {
    "content-type": "image/jpeg",
    "content-length": String(jpeg.length),
  };
  expect(
    (await DonorPhoto.read(new Response(new Uint8Array(jpeg), { headers })))
      .bytes,
  ).toEqual(jpeg);
  for (const response of [
    new Response(new Uint8Array(jpeg), { status: 206, headers }),
    new Response(new Uint8Array(jpeg), {
      headers: { ...headers, "content-range": "bytes 0-99/200" },
    }),
    new Response(new Uint8Array(jpeg), {
      headers: { ...headers, "content-type": "image/png" },
    }),
    new Response(new Uint8Array(jpeg), {
      headers: { ...headers, "content-length": "3" },
    }),
    new Response(new Uint8Array(jpeg), {
      headers: { ...headers, "content-length": "NaN" },
    }),
  ])
    await expect(DonorPhoto.read(response)).rejects.toThrow();
});
