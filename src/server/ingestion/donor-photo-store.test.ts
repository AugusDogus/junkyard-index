import { expect, test } from "bun:test";
import type { get, put } from "@vercel/blob";
import sharp from "sharp";
import { DonorPhotoStore } from "./donor-photo-store";

const jpeg = await sharp({
  create: { width: 4, height: 4, channels: 3, background: "blue" },
})
  .jpeg()
  .toBuffer();

function client(mode: "normal" | "discard" | "corrupt" = "normal") {
  const saved = new Map<string, Buffer>();
  const mimes = new Map<string, string>();
  const calls: { operation: string; path: string }[] = [];
  const sdk: { get: typeof get; put: typeof put } = {
    async put(path, body, options) {
      calls.push({ operation: "put", path });
      expect(options.access).toBe("private");
      expect(options.addRandomSuffix).toBe(false);
      if (
        options.contentType !== "image/jpeg" &&
        options.contentType !== "image/png" &&
        options.contentType !== "text/plain"
      )
        throw new Error("Expected a verified image MIME");
      mimes.set(path, options.contentType);
      if (!Buffer.isBuffer(body))
        throw new Error("Expected original JPEG bytes");
      if (mode !== "discard")
        saved.set(
          path,
          mode === "corrupt" ? Buffer.from("broken") : Buffer.from(body),
        );
      return {
        pathname: path,
        url: "https://private.example/" + path,
        downloadUrl: "https://private.example/" + path,
        contentType: options.contentType,
        contentDisposition: "inline",
        etag: "test-etag",
      };
    },
    async get(path, options) {
      calls.push({ operation: "get", path });
      expect(options.access).toBe("private");
      expect(options.useCache).toBe(false);
      const bytes = saved.get(path);
      const mime = mimes.get(path);
      if (!bytes) return null;
      if (!mime) throw new Error("Stored test image lacks MIME");
      return {
        statusCode: 200,
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(bytes));
            controller.close();
          },
        }),
        headers: new Headers({ "content-type": mime }),
        blob: {
          pathname: path,
          url: "https://private.example/" + path,
          downloadUrl: "https://private.example/" + path,
          contentDisposition: "inline",
          cacheControl: "",
          uploadedAt: new Date(),
          etag: "test-etag",
          contentType: mime,
          size: bytes.length,
        },
      };
    },
  };
  return { sdk, calls, saved };
}

test("private Blob adapter verifies independent uncached readback before returning an image identity", async () => {
  const mock = client();
  const store = DonorPhotoStore.vercelBlob("local-test-token", mock.sdk);
  const hash = await store.save(jpeg);
  expect(mock.calls).toEqual([
    { operation: "put", path: `donor-photos/${hash}` },
    { operation: "get", path: `donor-photos/${hash}` },
  ]);
  expect((await store.load(hash))?.bytes).toEqual(jpeg);
  const calls = mock.calls.length;
  expect(await store.load("../ingestion-runs/private")).toBeNull();
  expect(mock.calls).toHaveLength(calls);
});

test("private Blob adapter preserves PNG MIME and original bytes without conversion", async () => {
  const mock = client();
  const store = DonorPhotoStore.vercelBlob("local-test-token", mock.sdk);
  const png = await sharp(jpeg).png().toBuffer();
  const hash = await store.save(png);
  const stored = await store.load(hash);
  expect(stored?.mime).toBe("image/png");
  expect(stored?.bytes).toEqual(png);
});

test.each(["discard", "corrupt"] as const)(
  "does not publish a hash after %s storage write",
  async (mode) => {
    const mock = client(mode);
    const store = DonorPhotoStore.vercelBlob("local-test-token", mock.sdk);
    await expect(store.save(jpeg)).rejects.toThrow();
    expect(mock.calls.map((call) => call.operation)).toEqual(["put", "get"]);
  },
);

test("rejects a decodable replacement image under an existing content hash", async () => {
  const mock = client();
  const store = DonorPhotoStore.vercelBlob("local-test-token", mock.sdk);
  const hash = await store.save(jpeg);
  const replacement = await sharp(jpeg).negate().jpeg().toBuffer();
  const corruptedSdk: typeof mock.sdk = {
    ...mock.sdk,
    async get(path, options) {
      const result = await mock.sdk.get(path, options);
      if (!result || result.statusCode !== 200)
        throw new Error("Expected stored test photo");
      return {
        ...result,
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(replacement));
            controller.close();
          },
        }),
        blob: { ...result.blob, size: replacement.length },
      };
    },
  };
  const corrupted = DonorPhotoStore.vercelBlob(
    "local-test-token",
    corruptedSdk,
  );
  await expect(corrupted.load(hash)).rejects.toThrow("content hash");
});

test("photo URL references survive a fresh adapter and never use a missing or corrupt image", async () => {
  const mock = client();
  const url = "https://yard.example/donor.jpg";
  const first = DonorPhotoStore.vercelBlob("local-test-token", mock.sdk);
  expect(await first.findByUrl(url)).toBeNull();
  const hash = await first.save(jpeg);
  await first.rememberUrl(url, hash);
  const next = DonorPhotoStore.vercelBlob("local-test-token", mock.sdk);
  expect(await next.findByUrl(url)).toBe(hash);
  expect(await next.findByUrl(url + "?v=2")).toBeNull();
  mock.saved.delete(`donor-photos/${hash}`);
  expect(await next.findByUrl(url)).toBeNull();
  mock.saved.set(`donor-photos/${hash}`, Buffer.from("broken"));
  await expect(next.findByUrl(url)).rejects.toThrow();
});
