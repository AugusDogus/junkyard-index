import { createHash } from "node:crypto";
import sharp from "sharp";

export type DonorPhoto = {
  hash: string;
  bytes: Buffer;
  mime: "image/jpeg" | "image/png";
};
const maximumBytes = 4_000_000;
const maximumPixels = 16_000_000;

export const DonorPhoto = {
  maximumBytes,
  validHash(hash: string): boolean {
    return /^[a-f0-9]{64}$/.test(hash);
  },
  async parse(bytes: Uint8Array): Promise<DonorPhoto> {
    if (bytes.length === 0 || bytes.length > maximumBytes)
      throw new Error("Donor photo must contain 1-4,000,000 bytes");
    const copy = Buffer.from(bytes);
    const image = sharp(copy, {
      failOn: "warning",
      limitInputPixels: maximumPixels,
    });
    const metadata = await image.metadata();
    if (
      (metadata.format !== "jpeg" && metadata.format !== "png") ||
      (metadata.pages ?? 1) !== 1 ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > maximumPixels
    )
      throw new Error(
        "Donor photo must be a single JPEG or PNG within 16 million pixels",
      );
    // Decode all pixels before accepting the original, unmodified source bytes.
    await image.stats();
    return {
      hash: createHash("sha256").update(copy).digest("hex"),
      bytes: copy,
      mime: metadata.format === "jpeg" ? "image/jpeg" : "image/png",
    };
  },
  async read(response: Response): Promise<DonorPhoto> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Donor photo response has no body");
    try {
      const mime = response.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase();
      if (
        response.status !== 200 ||
        response.headers.has("content-range") ||
        (mime !== "image/jpeg" && mime !== "image/png")
      )
        throw new Error(
          `Donor photo response must be a complete HTTP 200 JPEG or PNG; received HTTP ${response.status}, MIME ${mime ?? "missing"}, range ${response.headers.get("content-range") ?? "none"}`,
        );
      const declared = response.headers.get("content-length");
      if (
        declared !== null &&
        (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)
      )
        throw new Error("Donor photo response exceeds its byte bound");
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.length;
        if (length > maximumBytes)
          throw new Error("Donor photo response exceeds its byte bound");
        chunks.push(next.value);
      }
      if (declared !== null && Number(declared) !== length)
        throw new Error(
          "Donor photo response length differs from Content-Length",
        );
      const photo = await DonorPhoto.parse(Buffer.concat(chunks));
      if (photo.mime !== mime)
        throw new Error(
          `Donor photo decoded as ${photo.mime} but the response declared ${mime}`,
        );
      return photo;
    } finally {
      try {
        await reader.cancel();
      } finally {
        reader.releaseLock();
      }
    }
  },
} as const;
