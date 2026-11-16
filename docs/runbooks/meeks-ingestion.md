# Meeks ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

Meeks Pic-N-Pull publishes one own-yard donor catalog at 1205 Virginia Avenue,
Martinsville, Virginia 24112. The native owner page, full inventory heading and
independent business marker bind the catalog to this yard. The nearby recycling
business at 1331 Virginia Avenue is not a second donor yard. Native YARD,
PROCESSING and STAGING labels describe sections of the catalog, not geographic
branches.

The published `https://meeksrecycling.com/pic-and-pull/` page is the primary
full inventory, containing 1,430 rows. The separate
`https://meeksrecycling.com/pic-and-pull-inventory/` page has 842 rows, all
represented in the primary page. Both are complete inline DataTables with
local pagination. The smaller view checks consistency without adding another
inventory population or inflating the primary duplicate denominator. A control
donor absent from the primary page blocks completeness.

The connector reads the owner page, primary inventory, consistency inventory,
primary closing and consistency closing. Both closing populations must match
their opening claims. All five reads and validations finish before callbacks
emit vehicles or yard metadata. The primary 1,430 rows reconcile to 1,415
accepted donors and 15 required rejects, with no duplicates. Nine short VINs,
one valid VIN without make/model and five conflicting model claims account for
the rejects. Six rejected valid VINs provide presence without replacing prior
metadata. Historical serial presence is retained if either native view supplies
a supported year, even when conflicting required claims quarantine the donor.

Native VIN or supported older serial, year, make/model and owned destination
are required. Optional metadata is nullable. The 739 accepted cross-view arrival
date disagreements become null. Native Burned colors and literal row `0` values
remain valid under existing normalization. Dates require a real MM/DD/YY
calendar day and follow the existing 20xx convention. All donor destinations
honestly link to the full inventory page because no donor-specific detail URL
is published. No inferred VIN, model alias or invented branch is used.

The shared source minimum is 471 donors. Existing 10% rejection, 25% duplicate
and 50% source drift limits remain. One logical catalog chunk performs five
sequential native requests, with the existing 1.6-second start-spacing rate
limiter, 20-second header/body deadlines and 2 MiB document limits. Requests
require complete owned HTTP 200 HTML, manual redirects and no automatic retry.
The entire catalog has a two-minute deadline. Strict start/complete cursors and
explicit terminal validation prevent incomplete runs from reconciling.

The independent reference checks 35,375 canonical values, all 25 fields for
each accepted donor. Registered-dispatcher memory database proofs compare those
values at emission, snapshot decoding and persistence. Six rejected prior VINs
keep their old metadata and clear missing flags, an absent seed retires and
an AutoRecycler mirror is replaced while preserving its first-seen date. The
1,421 rows in that proof include six artificial preservation seeds; admission
counts only 1,415 accepted donors.

Evidence is under `.scratchpad/coverage/parent-meeks-source-proof01/`,
`parent-meeks-final01/`, `parent-meeks-final02/`,
`parallel-mn-ia-ne-sd/meeks-implementation34/`,
`parallel-ut-co-ok/meeks-saved-census24/`,
`parallel-ut-co-ok/meeks-parent-review25/`,
`parallel-al-ms-la/meeks-review49/` and AK physical review56.
Saved closure does not establish an atomic provider snapshot or production
storage capacity.

The source runs unless its pause flag serves false. Qualification was local only. On request, ownership,
closure or quality failure, preserve previous inventory and inspect both native
views. Retry from the start cursor. Never force reconciliation from a failed
or incomplete catalog.
