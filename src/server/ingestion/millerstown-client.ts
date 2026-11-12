import { Data, Effect } from "effect";
import { millerstownPdfUrl } from "./millerstown-parser";
import {
  MILLERSTOWN_INVENTORY_URL,
  MILLERSTOWN_ROOT_URL,
} from "./millerstown-yard-metadata";
import type { ProviderRequestGate } from "./provider-http-client";

export class MillerstownProviderError extends Data.TaggedError(
  "MillerstownProviderError",
)<{ operation: string; cause: unknown }> {
  override get message() {
    return `Millerstown ${this.operation}: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}. Previous published inventory is preserved; no complete checkpoint is accepted. Inspect the native catalog and retry the start cursor.`;
  }
}

async function completeBytes(
  response: Response,
  signal: AbortSignal,
  maximum: number,
): Promise<Uint8Array> {
  if (!response.body) throw new Error("Native response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const read = async () => {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maximum)
        throw new Error(
          `Native response exceeds ${maximum} bytes; verify catalog growth`,
        );
      chunks.push(chunk.value);
    }
    const length = response.headers.get("content-length");
    if (
      length !== null &&
      !response.headers.has("content-encoding") &&
      (!/^\d+$/.test(length) || Number(length) !== total)
    )
      throw new Error(
        `Incomplete native body: expected ${length} bytes, received ${total}`,
      );
    return Buffer.concat(chunks);
  };
  let abort = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    signal.throwIfAborted();
    return await Promise.race([read(), aborted]);
  } finally {
    signal.removeEventListener("abort", abort);
    try {
      await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}

function request(url: string, kind: "html" | "pdf", gate: ProviderRequestGate) {
  return gate(
    Effect.tryPromise({
      try: async (signal) => {
        if (kind === "pdf") millerstownPdfUrl(url);
        else if (
          url !== MILLERSTOWN_ROOT_URL &&
          url !== MILLERSTOWN_INVENTORY_URL
        )
          throw new Error("Unsupported native HTML destination");
        const timeout = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
        const mime = kind === "pdf" ? "application/pdf" : "text/html";
        const response = await fetch(url, {
          method: "GET",
          redirect: "error",
          signal: timeout,
          headers: { "User-Agent": "JunkyardIndex/1.0", Accept: mime },
        });
        if (
          response.status !== 200 ||
          response.redirected ||
          response.headers.has("content-range") ||
          (response.url && response.url !== url) ||
          response.headers
            .get("content-type")
            ?.split(";")[0]
            ?.trim()
            .toLowerCase() !== mime
        ) {
          await response.body?.cancel();
          throw new Error(
            `Native ${kind} requires complete unredirected HTTP 200 and ${mime}; received status ${response.status}`,
          );
        }
        const bytes = await completeBytes(
          response,
          timeout,
          (kind === "pdf" ? 8 : 4) * 1024 * 1024,
        );
        if (
          kind === "pdf" &&
          !Buffer.from(bytes.subarray(0, 5)).equals(Buffer.from("%PDF-"))
        )
          throw new Error("Native application/pdf body has no PDF signature");
        return bytes;
      },
      catch: (cause) =>
        new MillerstownProviderError({
          operation: `${kind} read ${url}`,
          cause,
        }),
    }),
  );
}

export function fetchMillerstownHtml(
  kind: "root" | "inventory",
  gate: ProviderRequestGate,
) {
  return request(
    kind === "root" ? MILLERSTOWN_ROOT_URL : MILLERSTOWN_INVENTORY_URL,
    "html",
    gate,
  ).pipe(
    Effect.flatMap((bytes) =>
      Effect.try({
        try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        catch: (cause) =>
          new MillerstownProviderError({
            operation: `${kind} UTF-8 body`,
            cause,
          }),
      }),
    ),
  );
}
export function fetchMillerstownPdf(url: string, gate: ProviderRequestGate) {
  return request(url, "pdf", gate);
}
