export const IPULLUPULL_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/** Bounded, complete UTF-8 bodies for the CSV export and HTML media pages.
 * HTTP status, MIME and document grammar remain each caller's responsibility.
 */
export async function readIPullUPullResponseText(
  response: Response,
  context: string,
  signal: AbortSignal,
): Promise<string> {
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
      if (bytes > IPULLUPULL_MAX_RESPONSE_BYTES)
        throw new Error(
          `${context} exceeds 4 MiB; inspect catalog growth before retrying.`,
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
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    );
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
