import { get, put } from "@vercel/blob";
import { DonorPhoto } from "./donor-photo";

export interface DonorPhotoStore {
  /** Returns the stored content hash only after verifying independent readback. */
  save(bytes: Uint8Array): Promise<string>;
  load(hash: string): Promise<DonorPhoto | null>;
}

const pathname = (hash: string) => `donor-photos/${hash}`;

export const DonorPhotoStore = {
  /** Private Blob storage, kept separate from disposable ingestion snapshots. */
  vercelBlob(
    token: string,
    client: { get: typeof get; put: typeof put } = { get, put },
  ): DonorPhotoStore {
    const store: DonorPhotoStore = {
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
    return {
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
