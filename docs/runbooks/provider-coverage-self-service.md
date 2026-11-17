# Self-service coverage sweep, November 17, 2026

This lane adds **one Wisconsin business**, Al's Auto Salvage in Franklin, with
693 accepted vehicles and an enabled connector. All other assigned states gain
zero credits from this change. See [the connector runbook](alsauto-ingestion.md).
This does not bring every state to ten providers.

## Discovery artifact and limits

[The CSV](provider-coverage-self-service.csv) records 431 yard listings across
AL, AZ, AR, CA, CT, CO, IL, IN, IA, KS, KY, LA, MD, MA, MN, MS, MO, NE, NM, NY,
NC, OH, OK, OR, TN, UT, VA, WA and WI. It retains directory aliases and suspect
listings so they can be audited; **431 is not a count of distinct operating
businesses or fully qualified inventories**. No skipped states were added.
Aesop, Fenix and Spalding were excluded from this lane.

Discovery combined state web searches, Yard Pirates state directories,
SalvageAtlas self-service state directories, and PullHound's OpenStreetMap-backed
state listings. The first two directories contributed 500 raw entries and 394
name/city/state records. PullHound supplied 137 self-service map listings for
cross-checking, including additional Arizona, Colorado, New York and Oregon
leads. Two further search-only businesses are recorded. Official sites were
screened for 137 domains, with HTTP/HTTPS and www corrections where needed.

The CSV distinguishes existing state credits, native rejections, historical
rejections, closures, blocked sites, deferred checks and unresolved leads.
`inventory=y` means a public vehicle inventory was observed or the business is
already credited, **not** that it passes qualification. `inventory=n` means no
public vehicle catalog was confirmed, including inaccessible or website-less
listings. Homepage vendor tokens are explicitly marked unconfirmed. They are
not assertions that a usable connector endpoint exists.

This is a reproducible candidate census, not proof that every operating yard is
listed by these directories. Inaccessible sites, missing websites and deferred
URG graphs prevent an exhaustive qualification claim. The shared URG flock was
occupied, including a final nonblocking check, so follow-ups were not run without
the gate. Complete Recycling (MD), Waterloo (IA), Young's (NC), Northside (NY)
and Wally's (WI) still need complete native censuses. Arrival pages and directory
vehicle counts do not establish completeness.

## Shared unsupported front end

**YardConnect Pro / YardSmart occurs at six businesses:**

| Business                | State  |        Listed self-service yards |
| ----------------------- | ------ | -------------------------------: |
| U-Pick-It               | AZ     |                                2 |
| U Pull-It               | NE, IA |                                4 |
| Genesis Metal Recycling | NC     |                                1 |
| Wangelin's              | IA     |                                1 |
| Rupert's U-Pull-It      | VA     |                                1 |
| Chuck & Eddie's         | CT     | 1 confirmed self-service listing |

The first five use published WordPress search AJAX, with photo galleries rather
than VIN-bearing vehicle details. Their actual public responses omit VIN fields.
Wangelin's has five VIN-shaped strings only in some photo filenames, which does
not provide complete identity coverage. Rupert's newest observed set date is
May 28, 2026, also stale. Chuck & Eddie's v1.3.1 uses a normal GET form rather
than the newer search action. Its all-makes response has 870 table rows and no
VINs or donor detail links. Its three advertised business locations do not prove
three distinct inventory yards. There is no qualifier from this shared front end.
A future public VIN field could make a shared connector valuable. This is a
missing public inventory protocol, not an unidentified vendor; YardSmart itself
also appears behind the existing VinPlus connector.

## Other material outcomes

- Kingman Pic-A-Part's published public JSON catalog contains 1,139 donors and
  no VIN field. Its gallery uses the same public DTO; no private API was probed.
- UAPI's Joomla/Checkmate API reports 4,401 donors. The first 60 have blank VINs;
  the detail modal reuses those records. No full census is claimed.
- Dick's U-Pull-It's native listing and detail AJAX expose duplicate demo cards
  with an invalid placeholder VIN. Those are not a qualifying live inventory.
- Colorado Auto & Parts and DIY Auto Parts publish current inline donor tables
  without VINs. Jack's likewise publishes a native table without VINs.
- Barry's Pass Christian (MS) is **not** credited just because Theodore (AL)
  uses the same domain. The native VIN table has no yard column or selector,
  and the saved Ario directory binds only Theodore. Mississippi attribution
  remains unresolved.
- Route 34 (NY) remains a promising prior VIN-table lead, but its current
  connections close without responses. Pick-n-Save (VA) returns a firewall 403.
  Neither was admitted, and no CAPTCHA or challenge was bypassed.
- Pacific Auto Recycling (CA) says its public yard closed October 2, 2020.
  My Pick A Part (AZ) now says it is closed to the public. Mobile Pick-A-Part
  (AL) says opening soon. Lambert's old Hollander link redirects to a generic
  marketplace. U-Part-It's vehicle page says nothing is available to display.

## Request accounting and evidence

Research responses and logical request receipts are retained under this
worktree's `.scratchpad/self-service/`. Research redirects can add physical HTTP
requests beyond the logical receipt count. No captures were stored in `/tmp`.
All research was serial and paced with a normal browser User-Agent. The URG
shared lock was honored. No production state was changed.

The integrated provider's independently verified budget is **62 physical
requests per current full run**, capped at 82, with no retries or redirects.
The actual connector replay passed: 703 processed, 693 accepted, ten rejected,
zero duplicates, no errors. Committed compressed fixtures preserve all 62
opening/closing native bodies and their receipts, plus the address geocode.
