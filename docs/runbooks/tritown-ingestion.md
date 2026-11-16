# Tri Town Auto Salvage

See the current [source flags and census floors](provider-coverage-go-live.md).

TriTown adds one physical yard in Mount Joy, Pennsylvania, using its native
[current inventory](https://tritownautosalvage.com/cars/). Source ID: `tritown`.
Yard code: `mount-joy`.

The native page identifies 865 Milton Grove Rd, Mount Joy, PA 17552 and
717-409-5279. It states that the list represents the most up to date inventory
at that location, and that vehicle photographs are taken when cars enter the
yard. The saved published-yard census has no matching name or address.
Coordinates 40.12761, -76.49085 come from the matching public ASYD yard identity.

## Catalog and admission

The native `wpcm` initializer publishes a read-only GET listing endpoint. The
connector reads its current nonce, make directory and `power_kw-asc` sort from
`/cars/`. It requests every page without make, model or condition filters.
Each nonterminal page must contain five complete donor cards. Every response
must identify the requested page, preserve the declared final page and expose
the expected previous/next controls. The terminal page has no next control.

Admission requires native VIN or a genuine pre-1981 serial, year, make, model,
single-yard ownership and active catalog membership. The shared `inventoryVin`
predicate validates identity without decoding or repairing the source value.
Chevy, VW and Mercedes are mapped to source-directory Chevrolet, Volkswagen and
Mercedes-Benz labels. Unknown required metadata rejects that donor.

Color, stock, photo and source inventory date remain null when unproven. Native
`Posted` metadata is not an arrival date. The embedded parts service's CMS IDs
are not yard stock numbers. Explicit `Row` labels may populate the optional row
field. No remote photos are fetched or published by this connector.

The catalog includes a WordPress `/vehicle/__trashed/` destination. That record
is rejected conservatively, while its independently valid VIN supplies presence
evidence. It is not emitted as an available donor.

## Durable execution

`streamTritownInventory` processes at most 16 listing pages by default, with a
validated budget of 1 through 32 pages per chunk and a three-minute deadline.
Requests use the shared provider gate and make no automatic retries. HTTP 200,
expected MIME, complete bounded response bodies and the verified origin are
required. The current native yard identity and inventory statement are checked
again at every resumed chunk.

`TritownCursorSchema` validates serialized page coverage, accumulated identities,
page hashes and required-field rejection accounting. Duplicate donor URLs,
duplicate valid VINs, repeated pages, changed totals or changed make scope abort
the chunk. A callback failure returns no advanced checkpoint. The terminal
per-yard rejection limit remains 10 percent. Shared source minimum, drift,
feature-gate and destructive-reconciliation protections remain in force.

`scripts/soak-tritown.ts` aggregates caller-provided chunks while the caller
counts and discards donor batches. It has no database or Blob access.

## Verification

The 2026-11-12 saved catalog has 95 pages and 473 unique donor listings. Actual
connector replay emits 470 donors and rejects three, a 0.634 percent rejection
rate. Two source modern VINs have invalid lengths. The third rejection is the
trashed destination, with VIN `4S4BRCSC5D3215042` retained as presence evidence.
Both native pre-1981 serials are preserved unchanged.

Replay uses all retained native response bodies, serialized cursor resumes,
discarded batches and zero network requests. Evidence is in
`.scratchpad/coverage/parallel-pa-md-wv/evidence/tritown-connector-replay-next.json`.
The largest serialized checkpoint observed is 38,125 bytes. Focused tests cover
optional null fields, identity rejection, changed pages/totals, ownership,
callback failure/resume, serials, truncated responses and invalid checkpoints.

No production database write, Blob write or source enablement was performed.
