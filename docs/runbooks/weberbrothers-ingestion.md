# Weber Brothers Auto

See the current [source flags and census floors](provider-coverage-go-live.md).

The `weberbrothers` source covers Weber Brothers Auto, Inc., 1325 East Main Street Unit 1, Annville PA 17003-1612. The native About page and donor footer match ARA member 3553. Its association point is 40.3456, -76.5447, with unspecified precision.

The November 15 UTC census contains 5,825 unique native donor destinations across 162 listing pages. All donor details were captured and all 162 separately dated closing pages matched opening membership, titles, stocks and literal pagination. Quality gives 5,760 accepted unique donors, 63 rejects or quarantines and two benign duplicates. All eight conflicting VIN groups are quarantined; 50 valid rejected VINs remain presence evidence.

All inventory, accounting, presence evidence and yard callbacks wait until complete details, closing and source-wide guards pass. Durable validation requires the complete checkpoint, a 1,920-donor floor and the existing rejection, duplicate and previous-count safeguards. Native individual donor URLs remain the search and alert destinations. Optional photos, color, stock, dates and position remain nullable.

Durable chunks allow ten serial GETs. Each request has a combined 25-second request/body deadline, a 4 MiB response limit, no in-request retries and no redirect following. The shared gate holds through body cleanup and a two-second completed gap, including failures. Chunks have a 90-second deadline. Checkpoints are validated contiguous prefixes under 8 MiB; run capacity is 9,728 GETs and 4 GiB. Source failures preserve prior inventory and the last validated checkpoint.

Weber intermittently answers single detail pages with HTTP 500 or a dropped connection, and the same page succeeds later (November 26: two 500s and one `fetch failed` late in the run). A GET that answers HTTP 500, 502, 503 or 504, loses a connection that dropped, reset or timed out before a response, or misses its 25-second deadline is transient. After the chunk has advanced, the chunk returns its validated checkpoint as paused and the next chunk resends that GET. Before any advance the chunk defers (`ProviderNotReadyDeferred`), so the durable run waits five minutes and retries the same cursor, failing the source only after three hours without progress. Other statuses (403, 404, 501, 505), DNS, TLS and refused-connection failures, redirects, non-HTML responses, oversize or malformed bodies and parser changes stay fatal.

Four original HTTP500 database-error bodies and three original read-timeout receipts remain unchanged. The timeout outcomes remain unknown. Each of the seven gaps has a separate later successful public GET, selected after 560 untouched details succeeded and more than 28 minutes after the last failure. These successful captures do not establish completion or cancellation of the original calls and do not release historical holds. The historical REST401 remains untouched. No further Weber HTTP is planned.

Evidence is in `.scratchpad/provider-coverage/nov14-provider-goal/research/pa_md_wv/findings.md`, `weber-failure-receipts.json` and its referenced native bodies. Shared verification is saved as `weberbrothers-root-verification.json` under the goal directory. The read-only soak counts and discards inventory:

```sh
bun run soak:sources -- --sources=weberbrothers --cycles=1
```
