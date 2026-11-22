export const IPULLUPULL_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/** Bounded, complete UTF-8 bodies for the CSV export and HTML media pages.
 * HTTP status, MIME and document grammar remain each caller's responsibility.
 * Callers may lower the streaming byte limit without increasing the shared cap.
 */
export async function readIPullUPullResponseText(
  response: Pick<Response, "body" | "headers">,
  context: string,
  signal: AbortSignal,
  maximumBytes = IPULLUPULL_MAX_RESPONSE_BYTES,
): Promise<string> {
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    maximumBytes > IPULLUPULL_MAX_RESPONSE_BYTES
  )
    throw new Error(
      `${context} response byte limit must be an integer between 1 and ${IPULLUPULL_MAX_RESPONSE_BYTES}; use the default or a smaller source limit.`,
    );
  return readBoundedResponseText(response, context, signal, maximumBytes);
}

/** `utf-8-fatal` rejects malformed bytes. `utf-8-replace` substitutes U+FFFD,
 * only for a source whose declared UTF-8 pages carry stray single-byte text. */
export type ResponseTextDecoding = "utf-8-fatal" | "utf-8-replace";

export function decodeResponseText(
  bytes: Uint8Array,
  decoding: ResponseTextDecoding,
): string {
  return new TextDecoder("utf-8", {
    fatal: decoding === "utf-8-fatal",
  }).decode(bytes);
}

/** Complete UTF-8 reader with an explicit provider-owned streaming bound. */
export async function readBoundedResponseText(
  response: Pick<Response, "body" | "headers">,
  context: string,
  signal: AbortSignal,
  maximumBytes: number,
  decoding: ResponseTextDecoding = "utf-8-fatal",
): Promise<string> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1)
    throw new Error(
      `${context} requires a positive integer response byte limit.`,
    );
  if (!response.body)
    throw new Error(`${context} has no body; retry the request.`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const read = async () => {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes)
        throw new Error(
          `${context} exceeds ${maximumBytes / (1024 * 1024)} MiB; inspect catalog growth before retrying.`,
        );
      chunks.push(chunk.value);
    }
    const length = response.headers.get("content-length");
    if (
      length !== null &&
      !response.headers.has("content-encoding") &&
      (!/^\d+$/.test(length) || Number(length) !== bytes)
    )
      throw new Error(
        `Incomplete ${context}: received ${bytes} bytes, expected ${length}; retry the request.`,
      );
    return decodeResponseText(Buffer.concat(chunks), decoding);
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
