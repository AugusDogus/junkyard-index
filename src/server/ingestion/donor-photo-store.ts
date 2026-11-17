import { createHash } from "node:crypto";
import { get, put } from "@vercel/blob";
import { DonorPhoto } from "./donor-photo";

export interface DonorPhotoStore {
  /** Returns the stored content hash only after verifying independent readback. */
  save(bytes: Uint8Array): Promise<string>;
  load(hash: string): Promise<DonorPhoto | null>;
  /** Immutable published URL to verified content. A missing image is a cache miss. */
  findByUrl(url: string): Promise<string | null>;
  rememberUrl(url: string, hash: string): Promise<void>;
}

const referencePath = (url: string) =>
  `donor-photo-references/${createHash("sha256").update(url).digest("hex")}`;

const pathname = (hash: string) => `donor-photos/${hash}`;

export const DonorPhotoStore = {
  /** Private Blob storage, kept separate from disposable ingestion snapshots. */
  vercelBlob(
    token: string,
    client: { get: typeof get; put: typeof put } = { get, put },
  ): DonorPhotoStore {
    const store: DonorPhotoStore = {
      async findByUrl(url) {
        const result = await client.get(referencePath(url), {
          access: "private",
          useCache: false,
          token,
        });
        if (!result) return null;
        if (result.statusCode !== 200 || result.blob.size !== 64)
          throw new Error(
            "Stored photo reference is incomplete; prior inventory is preserved. Inspect private Blob storage before retrying.",
          );
        const hash = await new Response(result.stream).text();
        if (!DonorPhoto.validHash(hash))
          throw new Error("Stored photo reference has an invalid content hash");
        return (await store.load(hash)) ? hash : null;
      },
      async rememberUrl(url, hash) {
        if (!DonorPhoto.validHash(hash))
          throw new Error("Cannot cache an invalid photo content hash");
        await client.put(referencePath(url), Buffer.from(hash), {
          access: "private",
          token,
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: "text/plain",
        });
      },
      async save(bytes) {
        const photo = await DonorPhoto.parse(bytes);
        await client.put(pathname(photo.hash), photo.bytes, {
          access: "private",
          token,
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: photo.mime,
        });
        const stored = await store.load(photo.hash);
        if (!stored || !stored.bytes.equals(photo.bytes))
          throw new Error(
            "Donor photo storage readback failed; no durable image may be published",
          );
        return photo.hash;
      },
      async load(hash) {
        if (!DonorPhoto.validHash(hash)) return null;
        const result = await client.get(pathname(hash), {
          access: "private",
          useCache: false,
          token,
        });
        if (!result) return null;
        if (result.statusCode !== 200)
          throw new Error("Stored donor photo returned an incomplete response");
        const photo = await DonorPhoto.read(
          new Response(result.stream, {
            headers: {
              "content-type": result.blob.contentType,
              "content-length": String(result.blob.size),
            },
          }),
        );
        if (photo.hash !== hash)
          throw new Error(
            "Stored donor photo failed its content hash; do not fall back to an expiring provider URL",
          );
        return photo;
      },
    };
    return store;
  },
  memory(): DonorPhotoStore {
    const saved = new Map<string, Buffer>();
    const references = new Map<string, string>();
    return {
      async findByUrl(url) {
        const hash = references.get(url);
        return hash && saved.has(hash) ? hash : null;
      },
      async rememberUrl(url, hash) {
        if (!DonorPhoto.validHash(hash) || !saved.has(hash))
          throw new Error("Cannot cache an unpreserved photo");
        references.set(url, hash);
      },
      async save(bytes) {
        const photo = await DonorPhoto.parse(bytes);
        saved.set(photo.hash, photo.bytes);
        return photo.hash;
      },
      async load(hash) {
        const bytes = saved.get(hash);
        return bytes ? DonorPhoto.parse(bytes) : null;
      },
    };
  },
} as const;
