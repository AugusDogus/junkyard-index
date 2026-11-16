# URG Inventory InSite API research

Researched November 16, 2026. Research only. No connector changes, production inventory writes, messages, PRs, deployments or merges.

## Finding

IIS is a storefront for URG's centralized AutoPartSearch inventory and member-tiering network. A working public JSON parts search exists at `POST https://autopartsearch.com/parts/listing-api`. It returns native vehicle identities, VINs, stock numbers, owner codes and broker codes. This is a useful new integration lead, but **no complete, few-request, per-yard donor enumeration was verified for the full-service IIS tenants**.

The exact server-to-server hostname and authentication used by the IIS PHP plugin remain unproven. Public certificates identify `api.autopartsearch.com` and `api-aws.autopartsearch.com`, but both timed out from this environment. No PHP source, SDK, API specification or downloadable mobile client established their present contracts.

Two separate self-service catalogs offer much cheaper enumeration. They must not be substituted for their related full-service yards:

| Route                                                                 | Observed request cost                                                                                                  | Fields and ownership                                                                                                                         | Completeness established                                                                                                                                                              |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AutoPartSearch `POST /parts/listing-api`                              | One listing-page GET for public session/CSRF, then one POST per parts page, with additional search partitions required | VIN, stock, native YMM, `owner_urgid`, `broker_urgid`, part IDs and images                                                                   | No donor census. Supplier-only and YMM-without-part queries failed. Tested supplier parameters did not constrain ownership.                                                           |
| Smith Auto **Self Serve**, Ario `POST /functions/v1/search-inventory` | Seven inventory POSTs for 604 rows, plus one closing first-page reread. Two public key-discovery GETs when uncached    | VIN, stock, native YMM, row, placed/last-seen dates, yard UUID/name/slug                                                                     | All 604 advertised rows, unique IDs/stocks/VINs and contiguous ranks 1 through 604. Terminal metadata and identical closing first page. Separate catalog from Smith full-service IIS. |
| Intermountain's **iPull**, `https://ifipull.com/inventory/`           | One HTML GET exposes 568 rows; a closing reread would be another request                                               | YMM, reference/engine text, VIN, color, stock, row, arrival date. Yard identity comes from the official site, not a row-level supplier field | Entire rendered table obtained. No upstream total or closing reread. 568 stocks but 565 unique VINs, so not qualified for ingestion.                                                  |
| Nordstrom's **Ewe Pullet**, published `/inventory/ANY/ANY/?k=1`       | One GET tested                                                                                                         | No donor rows returned                                                                                                                       | Explicit no-results page. Not a bulk feed despite its published “Vehicle List” link.                                                                                                  |

## Scope, pacing and evidence

The branch starts at `origin/feat/provider-coverage-urg-tenants`, commit `c83ecc0502bac0b8859b41c02495a90ac33eb119`. Before research, read `AGENTS.md` and `docs/runbooks/urgiis-ingestion.md`, including the cap investigation, from `origin/feat/provider-coverage-urg-batch-a`, commit `8c85d48a55c52af70c1f5c347a4d4d7d1f46239d`.

Prior front-end endpoint, sitemap, stock-prefix and cap experiments were reused from that branch's `src/server/ingestion/urgiis-test-fixtures/cap-investigation.json.br`. This investigation did not repeat its pagination matrix or a full IIS census. It added live AJAX response captures, external host probes, marketplace API tests and alternate-provider checks.

All 187 direct HTTP attempts are recorded, including redirects, failures and downloads. Requests were serial through `flock /tmp/jyi-urg-gate.lock`, with `/tmp/jyi-urg-gate.last` updated after each response and at least 3.5 seconds before the next request. Redirects were followed manually. There were no automatic retries. This conservatively shared one gate across hosts and any cooperating local crawls. HTTP method POST was used only for public read-only searches/selectors. Neither inquiry nor offer submission action was called.

Downloads went into a new empty directory, `/tmp/urgiis-api-research-20261116`, and were treated as untrusted data. No downloaded JavaScript was executed and no APK was acquired or decompiled. Search-provider requests used executor MCP, not executor-home. No project or owner name was used in queries.

Committed evidence:

- [HTTP receipts](urgiis-api-research/http-requests.jsonl): IDs used below, UTC start, method, URL, sanitized parameters, result, byte count and original body SHA-256. Cookie/CSRF headers and actual public page nonces are omitted. Freeform transport errors are normalized.
- [Response observations](urgiis-api-research/observations.json.gz): exact safe AJAX response strings, whitelisted APS records, all observed Ario/iPull rows, source excerpts and verified comparisons. Decompress with `gzip -dc` and parse as JSON.
- [Host inventory](urgiis-api-research/host-inventory.json): capture provenance, certificate leads and request IDs per host.
- [Search results](urgiis-api-research/search-results.json.gz): 35 DataForSEO Google/Bing searches, queries, returned statuses and results. Search errors and irrelevant/autocorrected matches are retained.

Whole APS responses are not committed: they contain signed asset URLs and credential-named fields. Only explicit inventory fields are retained. Original-body hashes identify the local captures; they are not hashes of the projected evidence. The AJAX `raw_response_utf8` strings reproduce the original bodies byte for byte when encoded as UTF-8.

## 1. Backend and host investigation

### What is confirmed

[URG Website Solutions](https://u-r-g.com/website-solutions/) explicitly describes AutoPartSearch integration, stock-number search, repairable-vehicle search, latest arrivals and the ability to “Tier other URG Members data as your own” (request 31). [Member Tiering](https://u-r-g.com/member-tiering/) says yards choose partner inventory, ordinary tiering requires partner approval, and PRP/RCD members can tier across their networks (45). These explain why a tenant-branded catalog can contain foreign suppliers.

[Data Control](https://u-r-g.com/data-control/) documents URGNet Control Center, which authorizes third-party inventory/image sharing and monitors feed freshness (46). This proves an authorized feed-distribution product exists. It does not establish an anonymous feed endpoint.

The current APS listing client also refers to “URG/Python” record offsets, a Python-minted `search_id`, and upstream route names `api/tag/search` and `api/vstock/search` (95). These are comments in a public client, not evidence of their base URL, authentication, direct reachability or use by IIS PHP.

### Referenced hosts and probes

The inventory covers all matching URG, APS and image hosts in the scanned tenant pages, downloaded scripts, prior cap captures and official product pages. It is bounded to those captures. It is not a claim to have scanned every tenant or every asset. Email links in the official captures use `u-r-g.com`; no separate email-derived API host was found. Previously captured sitemaps supplied no donor host. No new donor iframe was found in the inspected pages.

| Host                                                                  | Observed behavior and limits                                                                                                                                                                                                                                 | Request IDs                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| `images.u-r-g.com`                                                    | Root and `/?list-type=2` return an old HTML/JavaScript redirect, not a bucket list. `/api`, `/v1`, `/swagger`, `/openapi.json`, `/graphql`, `/manifest.json`, `/ii57/` return 404.                                                                           | 2, 21-26, 71, 74, 99                  |
| `images.u-r-g.com/images/yard/NN36/stock/260444`                      | Published script's exact stock route returns an HTML photo gallery backed by CloudFront. Removing the stock yields one newline; adding a trailing slash to the known stock yields a gallery shell without photos. No stock roster.                           | 123-125                               |
| `da8h1v3w8q6n5.cloudfront.net`                                        | Root, list-type query and common API/docs paths return 403. `/ii57/`, `/ii57/images/` and `/ii57/?list-type=2` return zero-byte `application/x-directory` objects, not listings. Manifest path returns 403. A denied object does not establish a hidden API. | 19, 27, 30, 32, 35, 37, 78-81, 97-98  |
| `urg-wordpress-media-prod-770366365532-us-east-1-an.s3.amazonaws.com` | Public tenant WordPress asset host. Bucket root and `?list-type=2` both AccessDenied.                                                                                                                                                                        | 83-84                                 |
| `urgprod.s3.amazonaws.com`                                            | APS supplier-logo host. Bucket root and `?list-type=2` both AccessDenied.                                                                                                                                                                                    | 112-113                               |
| `www.inventoryinsite.com`, `inventoryinsite.com`                      | Root redirects form an HTTP/HTTPS loop. `/api` and `/v1` redirect to HTTP; `/swagger`, `/openapi.json`, `/graphql` are WordPress 404 pages. No specification.                                                                                                | 3, 18, 38-42, 60, 151                 |
| `www.autopartsearch.com`, `autopartsearch.com`                        | Public marketplace. Generic API/docs-looking root paths redirect into `/parts/<path>`, a storefront catch-all. Working routes are described below.                                                                                                           | 4, 14, 44, 47-50, 66, 73, 92, 103-109 |
| `www.u-r-g.com`, `u-r-g.com`                                          | Canonical public product/documentation site. Product pages disclose integrations and member services, not an API contract. Common API-path matrix was not run against the marketing site.                                                                    | 5, 16, 31, 33, 43, 45-46              |
| `urgdashboard.com`                                                    | Root redirects to `/login`. Public login confirms member boundary. `/api`, `/v1`, `/swagger`, `/openapi.json`, `/graphql` return 404.                                                                                                                        | 29, 52-53, 57, 61, 64, 68             |
| `www.urgsalessupport.com`                                             | Root redirects to `/index.cfm/login`. Login page reachable; common API/docs paths return 404. No authenticated navigation attempted.                                                                                                                         | 56, 82, 133-134, 137, 139, 141        |
| `software.u-r-g.com`                                                  | Public search lead. Root redirects to `/login.php`; page requires login. No installer or authenticated download accessed. No further API matrix.                                                                                                             | 80, 93                                |

AccessDenied and login boundaries were not bypassed. No object-name, credential or stock-number brute force was attempted. The CloudFront and S3 roots did not disclose JSON/XML manifests or object inventories.

### Certificate-only leads

Public certificate-transparency queries for APS, Inventory InSite and URG Dashboard returned production hostnames (127-128, 150). Queries for `u-r-g.com` and URG Sales Support returned 502 (129, 152). Dev/staging names were not probed.

- `api.autopartsearch.com` and `api-aws.autopartsearch.com`: HTTPS root, `/openapi.json`, `/docs` and HTTP root all hit 12-second connection timeouts, with no HTTP response (135-136, 138, 140, 143, 145, 153-154). This environment could not identify a current API/auth contract. Further path guessing would not resolve a connection failure.
- `aps.urgdashboard.com`: root, `/api`, `/v1`, `/swagger`, `/openapi.json`, `/docs`, `/graphql` and the comment-derived `/api/vstock/search` all return nginx 404 (155, 164-170).
- `interchange.urgdashboard.com`: connection timeout (156).
- `urghotkey.urgdashboard.com`: redirect to login (159), not followed into an authenticated workflow.
- `used.autopartsearch.com`: redirects to the current marketplace (142).
- `sellparts.autopartsearch.com`: TLS verification failure (144). Verification was not disabled.

A historical indexed Audizine snippet contains `api.autopartsearch.com//urgimages/or20/images/...jpg`. That supports past image-host use, not a present donor API. Certificates and old snippets alone do not establish that a service remains active.

## 2. IIS read-only AJAX and stock/tag routes

Used Heritage's public `/search-inventory/` page (1), its shipped `iisNonce`, and `https://heritageautoparts.com/wp-admin/admin-ajax.php`. Each request includes `action`, the public page nonce and the listed arguments. All returned HTTP 200. Exact bodies and request parameters are in the response evidence.

| Action                          | Arguments beyond nonce/action   | Exact response shape/content summary                                                                                                                                                         | ID  |
| ------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| `getVerticalIIS`                | None                            | `{"error":"false","vertical":...}`; 4,317 characters of search-form HTML                                                                                                                     | 6   |
| `getMakesIIS`                   | `year=2014`                     | `error:"false"`, 41 `{make,value}` selector entries                                                                                                                                          | 7   |
| `getModelsIIS`                  | `year=2014, make=FORD`          | `error:"false"`, 22 `{model,value}` selector entries                                                                                                                                         | 8   |
| `getpartCategoriesIIS`          | None                            | `error:"false"`, 428 `{category,value,partnumber}` entries                                                                                                                                   | 9   |
| `getpartCategoriesIISModal`     | None                            | `error:"false"`, 25 category strings and 1,234 part strings                                                                                                                                  | 10  |
| `getpartTypesIISModal`          | `category=Engine`               | `error:"false"`, 33 part strings                                                                                                                                                             | 11  |
| `getprefilldataIIS`             | `iisYear=2014, iisMake=FORD`    | `error:"false"`; option HTML in `makesSelect` (1,596 chars), `modelsSelect` (1,052), `partsSelect` (23,408)                                                                                  | 12  |
| `gettireaspectratio`            | `iisWidth=205`                  | `{"error":"false","aspectRatioSelect":""}`                                                                                                                                                   | 13  |
| `gettirerimdiameter`            | `iisWidth=205, aspect_ratio=55` | `{"error":"false","diameterRatioSelect":""}`                                                                                                                                                 | 15  |
| `fetch_part_type_by_sku_number` | `sku_number=NN36-260444`        | `success:false`, no matching parts. This stock-like value was not a published SKU.                                                                                                           | 17  |
| Same, real published SKU        | `sku_number=NN36950000`         | `{"success":true,"data":{"url":"https://heritageautoparts.com/parts/FORD/FORD_F250SD_PICKUP/260444/2014/ALTERNATOR/950000"}}`                                                                | 51  |
| `iis_get_video_by_stock`        | `stock_number=260444`           | `success:false`, message `No video found`; `raw_response` is a JSON string with stock number, empty `video_url`, `video_preview_url`, `vin_photo_url`, and `Failure: stock_number not found` | 20  |

None returned donor counts, stock lists, continuation tokens or a backend hostname. Selector contents are not vehicle inventory. Empty tire selectors and a missing video describe these particular inputs, not universal absence of data.

The known detail page (34) contains stock `260444`, VIN `1FT7X2A63EEA35540`, tag `R00950000` and actual SKU `NN36950000`. It grounded the successful SKU test.

- `/parts/search/260444` again returned HTTP 200 with a partial loading document and no closing HTML (54). It cannot establish enumeration.
- `/parts/search/%2A` returned an explicit empty result (55).
- `/parts/tagsearch/R00950000` resolved one alternator with stock/VIN/SKU (58). `/parts/tagsearch/R0095` and `/parts/tagsearch/%2A` were explicitly empty (59, 62).
- Prior stock-prefix/range and pagination findings remain in the cap investigation. No enumerable stock domain or wildcard donor list was found.
- The plugin's public directory root was empty; `readme.txt` returned 403 (171-172). No source archive was obtained or PHP disclosure attempted.

The U-Pull client is distinct. Ewe Pullet ships `iis-pro-upull` 1.8 and `iisupull.js` (173), with a same-origin fast selector path `/ajaxflowupull/getAllModelsIISupull`. The client says it avoids WordPress admin bootstrap. Its published read-only POST with `make=ANY` returned exactly `{"error":"false","models":[]}` (175). It did not expose a URG host or donor list. Its published ANY/ANY vehicle-list page returned no results (174), despite marketing more than 1,200 vehicles.

## 3. Public AutoPartSearch API and shared-pool ownership

### Reproducible anonymous request

Fetch a public listing page in a normal anonymous cookie session:

```text
GET https://autopartsearch.com/parts/ford/ford-f250sd-pickup/2014/alternator?supplier_urgid=NN36
```

Read its public `<meta name="csrf-token">`. Send JSON to `/parts/listing-api?supplier_urgid=NN36` in the same session with `Accept: application/json`, `Content-Type: application/json`, `X-Requested-With: XMLHttpRequest`, `X-CSRF-TOKEN: <page token>` and `X-Supplier-Urgid: NN36`. No login, member key or secret was used.

The successful price-sorted test (107) used:

```json
{
  "year": "2014",
  "make": "FORD",
  "model": "FORD F250SD PICKUP",
  "part_type": ["601"],
  "oem": "",
  "sort": "price_low",
  "limit": 50,
  "offset": 0,
  "record_offset": 0,
  "include_fitment": 0,
  "include_filters": 1,
  "include_parts": 1,
  "supplier_urgid": "NN36",
  "from_location": 0,
  "selected_filters": {}
}
```

Returned records include `vin`, `vstockno`, native `year/make/model`, `owner_urgid`, `broker_urgid`, `broker_type`, `sku`, `uniqueid`, `tag`, images, grade, mileage, status and days in stock. The grouped `by_location` representation also contains owner company/city/state. Values are parts observations; a VIN field's presence does not certify its validity or coverage of every vehicle.

### Enumeration and ownership tests

1. Supplier-only requests for NN36 and BB86, omitting YMM/part, returned HTTP 404 JSON with `success:false`, `urg_unavailable:true`, `message:"Failed to load parts. Please try again."` and empty results (103, 105). YMM with an empty `part_type` array failed the same way (108). These are search failures, not proof of empty yards.
2. The price-sorted NN36 query returned 50 parts from **15 foreign owner codes**, with no NN36 owner (107). Changing supplier in URL, JSON and header to BB86 returned the same ordered projected records, again without BB86 (109). Pagination said `total:50, has_more:true`; 50 is not a catalog total.
3. Repeated with the client's location mode, a fresh public page and its `search_id` for each supplier in the same anonymous session, `sort:"location"`, `from_location:1`, `include_preferred_parts:0`, `yard_limit:2`, `yard_offset:0` (177-180). Both suppliers produced the same 15 projected parts: brokers JJ57/NE24 and owners AA80/IA08/PP69/MI07/WY01. All were tier parts, with no NN36/BB86 owner. The earlier simpler request also returned this grouped shape (104).
4. GET `/parts/listing-api` returned a storefront 404 (100-101). The working method is POST. A GET failure must not be reported as absence of the API.

The tested supplier parameter is insufficient to establish owner isolation. This does not prove that no other supported supplier-scoped mode exists. Even a correct parts-only filter would need proof that every donor appears, including donors without a currently listed part. Fitment searches can return donors of other model years because their parts interchange.

### Shared pool

The best-supported explanation is URG member tiering, including PRP partner stock. Brown's official APS supplier profile is “Brown's Auto Salvage PRP” (110), and URG explicitly documents network tiering. The marketplace demonstrably distinguishes owner from broker. This is consistent with Brown's 39,835 IIS badges and foreign photo codes in the prior census, but **the exact request and tier configuration producing Brown's IIS pool were not recovered**.

For a future feed, `owner_urgid` is the promising ownership field; a broker, tenant domain or image bucket alone is insufficient. Public supplier mapping helps resolve codes:

| URG code   | Public directory identity                        |
| ---------- | ------------------------------------------------ |
| BB86       | Brown's Auto Salvage PRP, Bomoseen VT            |
| NN36       | Heritage Used Car and Truck Parts PRP, Mobile AL |
| MA09       | Linder's Inc, Worcester MA                       |
| NJ12, NJ29 | Lentini, Ringoes NJ                              |
| II08       | Lentini, Port Murray NJ                          |

`GET https://autopartsearch.com/api/suppliers/search` returned 200 member records with `id`, `profile_slug`, `urgid`, name, address/city, phone, website and coordinates (92). This is a directory response, not a donor feed or proof of a complete member universe. `?urgid=1&q=Brown` narrowed correctly (96). Supplier profiles' “View all inventory” routes `/seller-inventory/NN36` and `/seller-inventory/BB86` redirect to `/make?supplier_urgid=...` (119-120), continuing the make/model/part browser rather than revealing a bulk feed.

## 4. Other clients and public documentation

### Mobile and desktop

[URG Crush Images App](https://u-r-g.com/crush-images-app/) confirms Android/iPhone support for self-service members using CRUSH. It can scan a barcode, accept a stock number or select latest arrivals. The official page asks members to contact support to activate access/download/install (33). It supplies no package ID, Play/App Store link or APK URL.

Google Play searches for United Recyclers Group, URG Crush and URG Images yielded unrelated apps (65, 88, 115). APKPure returned Cloudflare 403 (69). APKMirror first autocorrected URG to URS; a second query with `nocorrect=true` explicitly found no results (114, 148). No APK was downloaded, so no decompilation or extracted mobile auth scheme can be claimed. `jadx` and `apktool` were not installed; the missing acquisition target was the primary blocker.

[URG Image Uploader](https://u-r-g.com/image-uploader/) describes nightly YMS image synchronization and installation by a URG technical specialist (43). The software portal requires login (80, 93). No public desktop installer was found. The public marketplace JavaScript was inspected as text, producing the listing route and upstream route comments above.

### Search coverage and limitations

Queries covered `iis-pro-v2`, `iis-pro-upull`, Inventory InSite, URG Web Services API, URGNet/API, image hostnames, API hostnames, AJAX action names, mobile clients and selected yard/YMS combinations. All 35 executor searches are retained. Several exact Google queries returned `Internal SE Server Error`; others autocorrected into unrelated products. They cannot prove that documents do not exist. Bing and literal/no-correction searches were also used.

Anonymous GitHub repository searches for InventoryInSite and AutoPartSearch returned zero repositories (63, 118). The broader URG/inventory search returned six unrelated urgency, restock and medical-inventory projects (91). GitHub code API required authentication (401, request 72), and anonymous web code search required sign-in (75). No private credentials were used. grep.app returned zero matches for `getprefilldataIIS`, `iis-pro-v2`, `images.u-r-g.com`, `Inventory InSite`, `getMakesIIS`, `api/vstock/search` and `urgdashboard` (67, 89-90, 116-117, 130-131).

No public plugin PHP distribution, relevant SDK or usable API specification was identified within this search coverage.

## 5. YMS and alternate-provider findings

URG officially supports **Pinnacle, Hollander Powerlink and Checkmate** for its image uploader (43), and **CRUSH** for the self-service photo app (33). This identifies supported upstream systems, not which system every IIS tenant currently runs. A historical Chuckran inventory-job search result mentions Pinnacle Pro or a similar system. A Brown's job result mentions Powerlink or Pinnacle. Neither proves a current per-yard installation.

The repository's Hollander Stores metadata/runbook and Ario directory/client were checked. No matching qualified full-service IIS business was identified in the existing Hollander store registry. Registry absence does not establish that a yard lacks Hollander software. Smith's official pages link Car-Part.com, but this only establishes a parts channel, not a public vehicle feed. No full-service donor feed was recovered from these upstream leads.

### Smith Auto Self Serve on Ario

The saved Ario directory at `src/server/ingestion/fixtures/ario/yards.json` lists Smith Auto inc Self Serve, yard UUID `bae5ae1b-6417-48f2-8e04-342b3e23293a`, slug `smith-auto-inc-self-serve-pawnee-city-ne`, organization `86c977b3-5ef2-4de7-85ea-6d2cf46f1147`. Website, phone and Pawnee City address agree with Smith's official site. The homepage explicitly separates “Search U-Pull Vehicles” at `/self-serve-yard/` (162, 176). The official self-service page did not expose an Ario iframe; the Ario identity match comes from its directory record.

Ario's public SPA/bundle (157, 160) provides an `sb_publishable_...` browser key. Using that public key as the `apikey` header, the existing supported transport is:

```text
POST https://zqfzqcyteuemzbnwtmcr.supabase.co/functions/v1/search-inventory
```

```json
{
  "yard_list": ["smith-auto-inc-self-serve-pawnee-city-ne"],
  "per_yard_limit": 100,
  "item_rank_offset": 0,
  "start_year": null,
  "end_year": null,
  "input_make": null,
  "input_model": null
}
```

Offsets 0, 100, 200, 300, 400, 500 and 600 returned 100/100/100/100/100/100/4 rows (163, 181-186). Every page advertised 604. The final metadata says `returned:4`, `total_matching:604`, `truncated:false`, `next_offset:604`. All 604 IDs, stocks and nonblank VIN strings are unique; all rows carry the same verified yard UUID. The first-page reread was identical (187). This verifies the advertised snapshot and terminal paging, not VIN check digits or the absence of any vehicles omitted upstream.

Fields include native YMM, VIN, stock, row, `date_placed`, `date_last_seen`, removed date, yard UUID/name/slug and stable item ID. Example stocks use `STK004301` style. This does not recover or explain Smith full-service IIS stock `261352`, nor justify replacing that catalog. The existing Ario client supports the protocol, but Smith is not in its qualified ingestion allowlist. No allowlist changed.

### Intermountain iPull

The official iPull inventory page (158) says `Updated: 11/16/26` and embeds all 568 rows directly in one HTML table. DataTables only paginates the already downloaded rows, with no `serverSide` or AJAX data source in its initializer. The table has Year, Make, Model, Reference, VIN, Color, Stock #, Vehicle Row and Arrival Date. Footer identity is iPull by Intermountain Auto, 3015 N 15th E, Idaho Falls ID, matching the sister-site lead in existing IIS captures.

All rows have VIN text and unique stocks, but only 565 unique VINs. For example, VIN `1GNDT13S422181887` appears on stocks STK015533 and STK015534. The response contains no row-level supplier code, provider total, or demonstrated individual vehicle destination. This is a promising separate self-service source for later qualification, not an admitted feed or evidence of complete Intermountain full-service stock.

Ewe Pullet explicitly describes itself as a different business from Nordstrom's Full Service Auto Recycling (161, 174). Its U-Pull plugin therefore cannot solve the parent full-service model cap merely by sharing a business relationship.

## Decision and next evidence needed

Do not replace full-service IIS enumeration with this public parts API on the current evidence. There is no demonstrated terminal owner-only donor cursor, and part existence/fitment is not a donor census. The current cap and shared-pool exclusions remain justified.

The strongest next step is obtaining a documented, authorized URG donor/vehicle feed through its member data-sharing product, or a publicly shipped client contract that demonstrably lists all vehicles by owner. Required proof is a per-owner query, native VIN/stock/YMM and ownership, bounded pagination with a terminal condition, plus comparison against known arrivals absent from capped model pages. Member access, secrets or support activation would need to be supplied through a separate authorized task; no contact was made here.

The self-service Ario and iPull routes can be investigated independently for their own physical yards. Neither result establishes a faster full-service IIS census.

Validation for this research deliverable: verified original response hashes, exact AJAX round-trips, both APS supplier comparisons, Ario ranks/totals/uniqueness/closing page, iPull row counts and duplicates, receipt spacing, compressed JSON integrity, document formatting and `git diff --check`. Product tests/builds were not run because only research documentation and evidence were changed.
