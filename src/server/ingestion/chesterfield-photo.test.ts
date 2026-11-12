import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import sharp from "sharp";
import {
  chesterfieldPhotoIdentity,
  preserveChesterfieldPhoto,
} from "./chesterfield-photo";
import { DonorPhotoStore } from "./donor-photo-store";

const originalFetch = globalThis.fetch;
function respond(
  handler: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
) {
  globalThis.fetch = Object.assign(handler, {
    preconnect: originalFetch.preconnect,
  });
}
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const token = (pur: string, message: string, exp: string | null) =>
  Buffer.from(JSON.stringify({ _rails: { pur, message, exp } })).toString(
    "base64url",
  ) +
  "--" +
  "a".repeat(40);
const reference = (exp = "2026-11-12T07:00:00Z") =>
  "https://api.yardsmartapp.com/rails/active_storage/representations/redirect/" +
  token("blob_id", "native-blob-message", exp) +
  "/" +
  token("variation", "native-variation-message", null) +
  "/image.jpg";
const jpeg = await sharp({
  create: { width: 8, height: 8, channels: 3, background: "green" },
})
  .jpeg()
  .toBuffer();
const gate = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect;

test("retains native signatures through the verified redirect and preserves source bytes", async () => {
  const raw = reference();
  const s3 =
    "https://cap-uploads-production.s3.amazonaws.com/native-object?X-Amz-Signature=published";
  const requests: string[] = [];
  respond(async (input, init) => {
    requests.push(String(input));
    expect(init?.redirect).toBe("manual");
    return requests.length === 1
      ? new Response(null, { status: 302, headers: { location: s3 } })
      : new Response(new Uint8Array(jpeg), {
          headers: { "content-type": "image/jpeg" },
        });
  });
  const store = DonorPhotoStore.memory();
  const hash = await Effect.runPromise(
    preserveChesterfieldPhoto(raw, store, gate),
  );
  expect(requests).toEqual([raw, s3]);
  expect((await store.load(hash))?.bytes).toEqual(jpeg);
});

test("compares stable blob identity without changing published expiry signatures", () => {
  expect(chesterfieldPhotoIdentity(reference())).toBe("native-blob-message");
  expect(chesterfieldPhotoIdentity(reference("2026-11-13T07:00:00Z"))).toBe(
    "native-blob-message",
  );
  for (const raw of [
    reference() + "?unsigned=1",
    reference().replace("https:", "http:"),
    reference().replace("api.yardsmartapp.com", "user@api.yardsmartapp.com"),
    reference().replace("representations/redirect", "blobs/redirect"),
  ])
    expect(chesterfieldPhotoIdentity(raw)).toBeNull();
  expect(
    chesterfieldPhotoIdentity(
      reference().replace("image.jpg", "17919925666431451120448470428927.jpg"),
    ),
  ).toBe("native-blob-message");
});

test.each([
  "http://api.yardsmartapp.com/image.jpg",
  "https://cap-uploads-production.s3.amazonaws.com.evil.example/image.jpg",
  "https://api.yardsmartapp.com:8443/image.jpg",
  "https://user:password@api.yardsmartapp.com/image.jpg",
  "http://127.0.0.1/private",
])(
  "refuses redirect outside the verified HTTPS hosts: %s",
  async (location) => {
    let requests = 0;
    respond(async () => {
      requests++;
      return new Response(null, { status: 302, headers: { location } });
    });
    await expect(
      Effect.runPromise(
        preserveChesterfieldPhoto(reference(), DonorPhotoStore.memory(), gate),
      ),
    ).rejects.toThrow("unverified");
    expect(requests).toBe(1);
  },
);

test("fails expired references without synthesizing or fetching replacement URLs", async () => {
  let requests = 0;
  let writes = 0;
  respond(async () => {
    requests++;
    return new Response("expired", { status: 404 });
  });
  await expect(
    Effect.runPromise(
      preserveChesterfieldPhoto(
        reference(),
        {
          async save() {
            writes++;
            return "a".repeat(64);
          },
          async load() {
            return null;
          },
        },
        gate,
      ),
    ),
  ).rejects.toThrow("complete HTTP 200 JPEG");
  expect(requests).toBe(1);
  expect(writes).toBe(0);
});

test("bounds redirect loops", async () => {
  let requests = 0;
  respond(async () => {
    requests++;
    return new Response(null, {
      status: 302,
      headers: { location: reference() },
    });
  });
  await expect(
    Effect.runPromise(
      preserveChesterfieldPhoto(reference(), DonorPhotoStore.memory(), gate),
    ),
  ).rejects.toThrow("four");
  expect(requests).toBe(4);
});
