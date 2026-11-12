import { Effect } from "effect";
import { z } from "zod";
import { DonorPhoto } from "./donor-photo";
import type { DonorPhotoStore } from "./donor-photo-store";
import type { ProviderRequestGate } from "./provider-http-client";

const payload = z.object({
  _rails: z.object({
    message: z.string().min(1).max(1024),
    pur: z.enum(["blob_id", "variation"]),
  }),
});

/** Inspect a native signed reference without changing its signature or expiry. */
export function chesterfieldPhotoIdentity(raw: string): string | null {
  const url = URL.parse(raw);
  if (
    !url ||
    url.origin !== "https://api.yardsmartapp.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return null;
  const match =
    /^\/rails\/active_storage\/representations\/redirect\/([^/]+)\/([^/]+)\/[^/]+$/.exec(
      url.pathname,
    );
  if (!match?.[1] || !match[2]) return null;
  try {
    const values = [match[1], match[2]].map((signed) => {
      if (!/^[A-Za-z0-9_+=-]+--[a-f0-9]{40,128}$/.test(signed)) return null;
      return payload.parse(
        JSON.parse(
          Buffer.from(signed.split("--")[0] ?? "", "base64url").toString(
            "utf8",
          ),
        ),
      )._rails;
    });
    return values[0]?.pur === "blob_id" && values[1]?.pur === "variation"
      ? values[0].message
      : null;
  } catch {
    return null;
  }
}

function allowedHop(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.port &&
    !url.hash &&
    (url.hostname === "api.yardsmartapp.com" ||
      url.hostname === "cap-uploads-production.s3.amazonaws.com")
  );
}

/** Fetch only published URLs through verified hosts. Never synthesize a renewal. */
export function preserveChesterfieldPhoto(
  raw: string,
  store: DonorPhotoStore,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    if (!chesterfieldPhotoIdentity(raw))
      return yield* Effect.fail(
        new Error(
          "Chesterfield donor photo has no verified native blob identity",
        ),
      );
    let current = new URL(raw);
    for (let hop = 0; hop < 4; hop++) {
      if (!allowedHop(current))
        return yield* Effect.fail(
          new Error(
            "Chesterfield photo redirect left its verified storage hosts",
          ),
        );
      const result = yield* gate(
        Effect.tryPromise({
          try: async (signal) => {
            const response = await fetch(current.href, {
              redirect: "manual",
              headers: {
                "User-Agent": "JunkyardIndex/1.0",
                Accept: "image/jpeg, image/png",
              },
              signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
            });
            if ([301, 302, 303, 307, 308].includes(response.status)) {
              const location = response.headers.get("location");
              await response.body?.cancel();
              const next = location ? URL.parse(location, current) : null;
              if (!next || !allowedHop(next))
                throw new Error(
                  "Chesterfield photo redirect has an unverified destination",
                );
              return { kind: "redirect" as const, next };
            }
            return {
              kind: "photo" as const,
              photo: await DonorPhoto.read(response),
            };
          },
          catch: (cause) =>
            cause instanceof Error ? cause : new Error(String(cause)),
        }),
      );
      if (result.kind === "redirect") current = result.next;
      else {
        const hash = yield* Effect.tryPromise({
          try: () => store.save(result.photo.bytes),
          catch: (cause) =>
            cause instanceof Error ? cause : new Error(String(cause)),
        });
        if (hash !== result.photo.hash)
          return yield* Effect.fail(
            new Error(
              "Chesterfield preserved photo differs from the source bytes",
            ),
          );
        return hash;
      }
    }
    return yield* Effect.fail(
      new Error(
        "Chesterfield photo exceeded four verified storage hops; refresh its native source reference before retrying",
      ),
    );
  });
}
