# Idaho Falls I-Pull qualification

The Idaho Falls source is local only, disabled and unpublished. Do not enable,
deploy or write inventory to production without separate authorization.

The complete saved native catalog contains 583 rows. The connector admits 555
unique donors and rejects 28 rows (4.80%), below the unchanged 10% limit. Twenty
rows have malformed modern VINs and two have no model. Three repeated-VIN groups
have different source stocks, so all six ambiguous rows are rejected. Their valid
VINs, and both valid VINs with missing models, remain presence evidence only.
Identical repeated rows are deduplicated, subject to the unchanged 25% limit.

The accepted 1973 Ford Mustang retains native serial `8532970167`. No identifiers,
model years or missing models are reconstructed. Source color, stock and vehicle
row are retained when usable. Photos are absent and remain null. The source uses
two-digit arrival years, so the canonical date remains null without inventing a
century or timezone; the parser retains the original arrival text.

## Ownership and enumeration

The official [root](https://ifipull.com/) calls the linked inventory its
"in-stock vehicles" and describes customers bringing tools to pull parts.
The physical yard is 3015 N 15th E, Idaho Falls ID 83401, 208-524-4461.
The matching native Google Maps address anchor supplies the business point
43.523078 / -112.006206 through its `!3d` / `!4d` values. Its map viewport center
has a different longitude and is not used.

The unfiltered [inventory page](https://ifipull.com/inventory/) returns all 583
rows and nine labeled columns in one HTML table. Its inspected DataTables
initializer performs client pagination, without an Ajax or server-side option.
The parser rejects changed columns, incomplete markup, additional filters or
pagination links, and a changed initializer until enumeration is proved again.
The saved page says `Updated: 11/11/26` and was captured November 11 at 19:04 UTC.

There are no donor permalinks. The destination is the source inventory page,
presented as a manual search. Search the table by VIN or stock to identify the
vehicle. Do not fabricate a donor URL or a prefilled search parameter. Featured
cars and the separate retail car catalog do not join to this donor inventory.

## Connector behavior

One checkpoint reads the root and complete inventory, through the existing
1,600 ms request gate. Only complete HTTP 200 HTML at the verified destinations
is accepted. Redirects, partial responses, wrong MIME, invalid UTF-8, inconsistent
body lengths, oversized bodies and read failures block reconciliation. Requests
have 20-second timeouts, no automatic retry and a two-minute catalog budget.

Ownership, enumeration, required identities and quality limits are checked
before yard or vehicle callbacks. Callback failure returns no completed cursor.
Strict `start` and `complete` checkpoints use the durable source codec; resuming
`complete` makes no request. Shared registration requires a 450-donor floor and
retains the existing rejection, duplicate and previous-run drift guards.

## Local proof

Source evidence lives in
`.scratchpad/coverage/new-leads/near-qualified-controls/id-ipull-inventory.html`
and `.scratchpad/coverage/new-leads/id-ipull.html`. No recrawl was required.

The research and actual connector replay are under
`.scratchpad/coverage/parallel-ut-co-ok/refill-20261112/`:

- `evidence/id-ipull-qualification-review.json` and `id-ipull-native-records.json`.
- `evidence/id-ipull-identity-review.json` and `id-ipull-native-coordinates.json`.
- `idipull-implementation-replay.ts` and `idipull-implementation-replay/`.

The replay runs the application connector and soak over the saved bodies,
checks every parsed native field against the independent 583-row extraction,
and compares the emitted VIN set to the 555 unambiguous source records. It also
checks five valid rejected VINs, both actual durable codec round trips, terminal
no-request behavior and shared source validation. Canonical records, yards,
request provenance and checkpoints are saved separately.

Focused checks:

```sh
bun test src/server/ingestion/idipull-*.test.ts
bunx oxlint src/server/ingestion/idipull-*.ts scripts/soak-idipull.ts
bun run typecheck
```
