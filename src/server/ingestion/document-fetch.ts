/** The `fetch` subset document clients use. Production swaps in a browser
 * session for hosts that challenge datacenter IPs; tests and local runs keep
 * the global fetch, resolved per call so test doubles still apply. */
export type DocumentFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;
export const httpDocumentFetch: DocumentFetch = (url, init) => fetch(url, init);
