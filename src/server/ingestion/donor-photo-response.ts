import { DonorPhoto } from "./donor-photo";
import type { DonorPhotoStore } from "./donor-photo-store";

/** Loads preserved bytes only. A public image request never contacts a provider. */
export async function donorPhotoResponse(
  hash: string,
  store: DonorPhotoStore,
): Promise<Response> {
  if (!DonorPhoto.validHash(hash)) return new Response(null, { status: 404 });
  try {
    const photo = await store.load(hash);
    if (!photo) return new Response(null, { status: 404 });
    if (photo.hash !== hash)
      throw new Error(
        "Donor photo store returned a different content identity",
      );
    return new Response(new Uint8Array(photo.bytes), {
      headers: {
        "Content-Type": photo.mime,
        "Content-Length": String(photo.bytes.length),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        ETag: `"${hash}"`,
      },
    });
  } catch (cause) {
    console.error("Preserved donor photo unavailable", { hash, cause });
    return new Response(null, {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "60" },
    });
  }
}
