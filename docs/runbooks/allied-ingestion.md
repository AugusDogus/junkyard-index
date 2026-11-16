# Allied Auto Wrecking ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

Allied Auto Wrecking is one full-service yard at 32 Dustin Tavern Rd, Weare,
New Hampshire 03281, phone 603-529-7211. Its public site binds the URG Inventory
InSite catalog to supplier KK25. The US Census Public_AR_Current geocoder
matched the published street, city, state and ZIP exactly: latitude
43.027831788738, longitude -71.693656846442. The saved Census response is an
offline test fixture.

The connector follows the homepage, latest arrivals, `/parts/`, every published
make directory and every published model page. It then rereads the homepage,
make directory and all model directories. Changed owner identity, labels, paths
or badges stop the run before any canonical callback. No donor detail requests
are required. Every model card supplies its own year, make/model, VIN, stock
and part-search destination. Published category badges are diagnostic, since
their sums disagree with each other and with the actual card enumeration.
The final warnings report each count without inventing an advertised yard total.

Only stock codes matching `^\d{1,2}[A-L]\d{3}$` enter donor validation. Other
records, including blank stock codes, are counted as `recordsExcluded` and
reported as skipped. Some may represent real trucks that cannot be identified;
the rule does not claim they are all part bins. A normal-format stock with a
missing or invalid VIN remains a reject. The source validates modern VIN check
digits and accepts supported pre-1981 serials. It does not decode VINs, repair
identities, infer makes or substitute missing native year/make/model fields.

Conflicting VIN/destination groups are quarantined together. Valid rejected
VINs remain presence evidence so reconciliation preserves their existing rows.
Identical donors merge by VIN; conflicting optional photos or dates become
null. The owned native `See Parts` destination is preserved for accepted donors.

The November 15, 2026 census followed 45 makes and 482 model pages. It found
3,371 model cards plus 39 duplicate arrivals: 2,507 accepted unique donors,
86 rejected normal-stock observations, 778 excluded nonstandard-stock records
and 39 benign duplicates. Rejection is 86 / 2,632 eligible observations (3.27%).
The 86 rejects include 48 invalid VIN observations and 38 quarantined identity
conflicts. Make badges sum to 3,181, model badges to 3,389, and 23 model pages
disagree with their badges. These discrepancies remain warnings. The complete
ordered Brotli response archive preserves separate opening and closing controls.
Compression retains the raw HTML, including repeated URLs; tests never replace
closing responses with opening responses.

The source floor is 835 unique donors. The normal-stock rejection limit is
10%, the duplicate limit is 25%, and accepted inventory must retain at least
50% of the preceding published complete run. Exclusions never dilute the
rejection denominator. No inventory is emitted until the entire graph and all
closing controls pass. Durable reconciliation requires an explicit complete
cursor and repeats the shared validation gates.

Each chunk permits at most four physical GETs and four minutes. The adapter
uses a current browser User-Agent, manual redirects, complete owned HTTP 200
HTML, a combined 45-second request/body deadline and a 2 MiB document cap.
A shared serial gate waits two seconds after each complete response, including
failures. There are no automatic retries. Whole runs are capped at 1,024 GETs
and 128 MiB, reserving a full document allowance before each request. Checkpoints
are capped at 8 MiB and bind the qualification contract and native control prefix.

Run a count-only soak with
`bun run soak:sources -- --sources=allied --max-pages=600`. The soak serializes every
checkpoint, preserves incomplete state at its budget, prints exclusion and badge
warnings, and writes no canonical inventory. Tests use saved native responses
and never contact the provider or Census.

The source runs by default. `ingestion-source-allied` pauses ingestion when it serves false. On a request, parser, guard or checkpoint failure, keep prior
inventory and inspect the named operation and saved response. Resume the last
validated checkpoint only if its contract is unchanged. Restart after graph
drift or policy changes. Never force reconciliation from incomplete evidence.
