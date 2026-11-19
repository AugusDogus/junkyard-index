import { VinDecode, type VinIdentity } from "./vin-decode";

export type VpicDecodeResult = {
  status: "complete" | "unavailable";
  decodes: Map<string, VinDecode>;
};

export type VpicClient = {
  decode(requests: readonly VinIdentity[]): Promise<VpicDecodeResult>;
};

type Transport = (url: string, init: RequestInit) => Promise<Response>;
const ENDPOINT =
  "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/";
const MAX_ATTEMPTS = 3;

export function createVpicClient(
  options: {
    fetch?: Transport;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): VpicClient {
  const transport = options.fetch ?? fetch;
  const sleep =
    options.sleep ??
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let queue: Promise<unknown> = Promise.resolve();
  async function batch(
    requests: readonly VinIdentity[],
  ): Promise<VpicDecodeResult> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // One request at a time with at least one second between attempts.
      await sleep(1000 * 2 ** attempt);
      try {
        const response = await transport(ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent":
              "Vehicle VIN canonicalization/1.0 (public vehicle inventory)",
          },
          body: new URLSearchParams({
            format: "json",
            data: requests.map((row) => `${row.vin},${row.year}`).join(";"),
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (response.status === 429 || response.status >= 500) {
          const retryAfter = response.headers.get("Retry-After");
          const delay =
            retryAfter === null
              ? 0
              : /^\d+$/.test(retryAfter)
                ? Number(retryAfter) * 1000
                : Date.parse(retryAfter) - Date.now();
          // A long server cooldown defers the pattern to a later publication.
          if (delay > 10_000)
            return { status: "unavailable", decodes: new Map() };
          if (delay > 0) await sleep(delay);
          continue;
        }
        if (!response.ok) return { status: "unavailable", decodes: new Map() };
        const body: unknown = await response.json();
        if (!VinDecode.isResponse(body)) continue;
        return {
          status: "complete",
          decodes: VinDecode.parseResponse(body, requests),
        };
      } catch {
        // Timeouts, transport failures and malformed responses retry, then
        // return no identities. Publication keeps the source normalization.
      }
    }
    return { status: "unavailable", decodes: new Map() };
  }
  return {
    decode(requests) {
      const run = async () => {
        const result = new Map<string, VinDecode>();
        for (let start = 0; start < requests.length; start += 50) {
          const decoded = await batch(requests.slice(start, start + 50));
          for (const [key, value] of decoded.decodes) result.set(key, value);
          // Three failed attempts trip the breaker for this decode pass.
          if (decoded.status === "unavailable")
            return { status: "unavailable" as const, decodes: result };
        }
        return { status: "complete" as const, decodes: result };
      };
      const pending = queue.then(run, run);
      queue = pending;
      return pending;
    },
  };
}

export const vpicClient = createVpicClient();
