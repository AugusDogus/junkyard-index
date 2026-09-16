import { Effect, Schema } from "effect";
import { PULLNSAVE_INVENTORY_PAGE_URL } from "./pullnsave-config";
import {
  fetchProviderText,
  type ProviderRequestGate,
} from "./provider-http-client";

const BootstrapSchema = Schema.Struct({ nonce: Schema.NonEmptyString });

function attribute(attributes: string, name: string): string | undefined {
  const matches = [
    ...attributes.matchAll(
      /([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
    ),
  ].filter((match) => match[1]?.toLowerCase() === name);
  if (matches.length > 1)
    throw new Error(`Duplicate ${name} attribute in the yard selector`);
  const match = matches[0];
  return match?.[2] ?? match?.[3] ?? match?.[4];
}

/** The public inventory selector is authoritative for eligibility. Cached yard
 * addresses and inventory rows are not evidence that a yard is still listed.
 */
export function parsePullNSaveYardList(html: string) {
  const clean = html.replace(
    /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    "",
  );
  if (/<!--|<(?:script|style)\b/i.test(clean))
    throw new Error("Unclosed comment or script in the yard directory");
  const openings = [
    ...clean.matchAll(/<select\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi),
  ].filter((match) => attribute(match[1] ?? "", "id") === "pns_yard");
  const opening = openings[0];
  if (openings.length !== 1 || !opening)
    throw new Error("Expected exactly one public #pns_yard selector");
  const remainder = clean.slice(opening.index + opening[0].length);
  const end = remainder.search(/<\/select\s*>/i);
  if (end < 0) throw new Error("Unclosed public yard selector");
  const body = remainder.slice(0, end);
  if (/<select\b/i.test(body)) throw new Error("Nested public yard selector");
  const options = [
    ...body.matchAll(
      /<option\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/option\s*>/gi,
    ),
  ];
  if (options.length * 2 !== [...body.matchAll(/<\/?option\b/gi)].length)
    throw new Error("Incomplete public yard options");
  const ids = options.map((option) => {
    const value = attribute(option[1] ?? "", "value");
    if (
      !value ||
      !/^(0|[1-9]\d*)$/.test(value) ||
      !Number.isSafeInteger(Number(value))
    )
      throw new Error("Invalid public yard ID");
    return Number(value);
  });
  if (
    new Set(ids).size !== ids.length ||
    ids.filter((id) => id > 0).length === 0
  )
    throw new Error("Public yard list is empty or contains duplicate IDs");
  const payload = /var\s+pns_inventory_sf_ajax\s*=\s*(\{[^;]+\})/.exec(
    html,
  )?.[1];
  if (!payload)
    throw new Error("Public inventory directory bootstrap is missing");
  const { nonce } = Schema.decodeUnknownSync(BootstrapSchema)(
    JSON.parse(payload),
  );
  return { nonce, yardNumbers: new Set(ids.filter((id) => id > 0)) };
}

export function fetchPullNSaveYardList(requestGate: ProviderRequestGate) {
  return fetchProviderText({
    url: PULLNSAVE_INVENTORY_PAGE_URL,
    context: "Pull-N-Save current public yard list",
    headers: { "User-Agent": "JunkyardIndex/1.0" },
    requestGate,
    retry: { retryLimit: 2, retryNetworkErrors: false, jitter: false },
    onResponse: (response) => {
      if (response.status === 206 || response.headers.has("content-range"))
        throw new Error(
          "Partial public yard list; eligibility cannot be verified",
        );
    },
  }).pipe(
    Effect.flatMap((html) =>
      Effect.try({
        try: () => parsePullNSaveYardList(html),
        catch: (cause) =>
          new Error(
            `Pull-N-Save yard eligibility could not be verified: ${cause instanceof Error ? cause.message : String(cause)}. Inspect the public inventory selector before retrying; no catalog was accepted.`,
          ),
      }),
    ),
  );
}
