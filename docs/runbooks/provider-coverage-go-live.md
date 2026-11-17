# Provider coverage go-live

Every registered source participates in new ingestion runs by default. Vercel
Flags are pause switches: serving boolean false from `ingestion-source-<source>`
pauses that source. Missing flags, evaluation failures and malformed values keep
it enabled. Creating a new Vercel flag that serves false pauses its source
immediately. This code change does not create or alter production flags.

New source and physical-yard floors use approximately one third of accepted
saved census inventory, rounded down with a minimum of one. Existing floors
already at or below that level stay unchanged. Multi-yard source floors sum their
yard floors. The 50% previous-run drift guard, rejection limits, duplicate limits,
closing checks and all floors for sources already on `origin/main` stay unchanged.

Ario has no fixed per-yard census floor to loosen. Its existing 100-donor source
floor and per-yard 50% previous-run drift checks stay unchanged. Native new Ario
yards retain their VIN, complete-census, freshness and rejection checks.

The following floors use committed qualification evidence. The Stricker follow-up includes new read-only provider qualification, documented in [the Hollander runbook](hollanderstores-ingestion.md#stricker-response-bound-repair-november-17). These values supersede historical qualification receipts. Pickers includes Texarkana, Longview and Reno (540 + 843 + 545 = 1,928); Midway includes Muncie, Liberty and Tulsa (763 + 1,064 = 1,827). Their source floors are 642 and 609, respectively.

| Source or yard                    | Qualified accepted census | Previous floor | New floor |
| --------------------------------- | ------------------------: | -------------: | --------: |
| `hollanderstores/leblancsauto`    |                       541 |            450 |       180 |
| `hollanderstores/blvdautoparts`   |                        83 |             65 |        27 |
| `hollanderstores/standardauto`    |                        79 |             65 |        26 |
| `hollanderstores/petrillosauto`   |                        59 |             45 |        19 |
| `hollanderstores/kirchhaynautopa` |                       114 |             90 |        38 |
| `hollanderstores/piperautoparts`  |                       567 |            456 |       189 |
| `hollanderstores/sunlineparts`    |                       247 |            197 |        82 |
| `hollanderstores/spilmanautopart` |                       489 |            392 |       163 |
| `hollanderstores/robertsons`      |                       749 |            601 |       249 |
| `hollanderstores/milfordmotorsus` |                       103 |             84 |        34 |
| `hollanderstores/terryvilleauto`  |                       266 |            213 |        88 |
| `hollanderstores/aabcoautoparts`  |                     5,328 |          4,266 |     1,776 |
| `hollanderstores/flap`            |                     5,639 |          4,589 |     1,879 |
| `hollanderstores/windyhill`       |                       127 |            105 |        42 |
| `hollanderstores/biloxiauto`      |                     1,406 |          1,133 |       468 |
| `hollanderstores/rogersauto`      |                       676 |            541 |       225 |
| `hollanderstores/lamarautosalvag` |                       550 |            447 |       183 |
| `hollanderstores/brother`         |                        24 |             20 |         8 |
| `hollanderstores/aplusparts`      |                     2,838 |          2,292 |       946 |
| `hollanderstores/northverdeauto`  |                       191 |            153 |        63 |
| `hollanderstores/bandkautosalvag` |                       123 |            104 |        41 |
| `hollanderstores/conrads`         |                     3,227 |          2,589 |     1,075 |
| `hollanderstores/rockitopauto`    |                       249 |            200 |        83 |
| `hollanderstores/bandmauto`       |                        55 |             44 |        18 |
| `hollanderstores/nwaupiautoparts` |                     7,462 |          6,060 |     2,487 |
| `hollanderstores/branson`         |                         5 |              4 |         1 |
| `hollanderstores/paulsouin`       |                       742 |            623 |       247 |
| `hollanderstores/paulsfwin`       |                     2,033 |          1,658 |       677 |
| `hollanderstores/paulswvin`       |                     1,560 |          1,295 |       520 |
| `hollanderstores/paulmerin`       |                     1,279 |          1,064 |       426 |
| `hollanderstores/paulslkin`       |                     1,314 |          1,120 |       438 |
| `hollanderstores/paulelkin`       |                     1,040 |            852 |       346 |
| `hollanderstores/pauldemin`       |                       732 |            601 |       244 |
| `hollanderstores/paulsknox`       |                       457 |            372 |       152 |
| `hollanderstores/paullogin`       |                       516 |            420 |       172 |
| `hollanderstores/macksautoparts`  |                     1,155 |            386 |       385 |
| `hollanderstores/alsautosalvage`  |                       703 |            238 |       234 |
| `hollanderstores/mstrecycling`    |                       224 |             77 |        74 |
| `hollanderstores/foreignusedpart` |                     2,124 |            719 |       708 |
| `hollanderstores/mkauto`          |                     2,009 |            672 |       669 |
| `hollanderstores/hartsparts`      |                       367 |            131 |       122 |
| `hollanderstores/rainbowauto`     |                       304 |            109 |       101 |
| `hollanderstores/pascoauto`       |                     6,146 |          2,059 |     2,048 |
| `hollanderstores/awcaw`           |                       201 |             70 |        67 |
| `hollanderstores/strickerauto`    |                    12,330 |            n/a |     4,110 |
| `hollanderstores/florasauto`      |                       581 |       New yard |       193 |
| `hollanderstores/tvilleauto`      |                       318 |       New yard |       106 |
| `heavytruckparts/rydemore`        |                         8 |              5 |         2 |
| `heavytruckparts/westside`        |                       565 |            450 |       188 |
| `heavytruckparts/allcounty`       |                        40 |             30 |        13 |
| `heavytruckparts/crest`           |                       218 |            175 |        72 |
| `heavytruckparts/catruck`         |                         4 |              3 |         1 |
| `heavytruckparts/american`        |                         3 |              2 |         1 |
| `vinplus/pocatello`               |                       710 |            600 |       236 |
| `vinplus/ryans`                   |                     1,406 |          1,200 |       468 |
| `vinplus/sterling-heights`        |                     1,082 |            900 |       360 |
| `vinplus/hinesville`              |                       464 |            400 |       154 |
| `vinplus/killeen`                 |                     1,558 |          1,300 |       519 |
| `vinplus/lubbock`                 |                     1,085 |            850 |       361 |
| `byot/1123`                       |                     1,285 |          1,000 |       428 |
| `byot/1183`                       |                       967 |            800 |       322 |
| `byot/1218`                       |                     1,073 |            900 |       357 |
| `byot/1259`                       |                     1,036 |            850 |       345 |
| `byot/1289`                       |                       969 |            800 |       323 |
| `urgiis/eagle`                    |                     1,448 |          1,200 |       482 |
| `urgiis/linders`                  |                     3,274 |          2,600 |     1,091 |
| `urgiis/chuckran`                 |                     3,671 |          2,900 |     1,223 |
| `urgiis/united`                   |                    12,356 |          9,800 |     4,118 |
| `urgiis/ace-iowa`                 |                     1,524 |          1,200 |       508 |
| `urgiis/lentini-ringoes`          |                     2,429 |          1,900 |       809 |
| `urgiis/lentini-port-murray`      |                       924 |            700 |       308 |
| `urgiis-tenant/lentini`           |                     3,353 |          2,600 |     1,117 |
| `urgiis/dings`                    |                     1,110 |            800 |       370 |
| `urgiis/bishops`                  |                     3,362 |          2,600 |     1,120 |
| `urgiis/ace-st-paul`              |                     3,015 |          2,400 |     1,005 |
| `urgiis/chucks`                   |                     2,601 |          2,000 |       867 |
| `urgiis/central-nh`               |                     2,477 |          1,900 |       825 |
| `chesterfield`                    |                     2,111 |          1,800 |       703 |
| `utpap`                           |                     1,727 |          1,500 |       575 |
| `tritown`                         |                       470 |            400 |       156 |
| `whitebradstreet`                 |                       382 |            350 |       127 |
| `midway`                          |                     1,827 |            600 |       609 |
| `rightway`                        |                       543 |            450 |       181 |
| `ddauto`                          |                        67 |             50 |        22 |
| `rivervalley`                     |                     1,553 |          1,300 |       517 |
| `fenix`                           |                     4,595 |          4,000 |     1,531 |
| `importapart`                     |                        75 |             60 |        25 |
| `bigtruckpage`                    |                        48 |             40 |        16 |
| `sandw`                           |                       624 |            500 |       208 |
| `denton`                          |                     2,297 |          2,000 |       765 |
| `scotts`                          |                       976 |            800 |       325 |
| `oem`                             |                     2,158 |          1,800 |       719 |
| `dutchers`                        |                       579 |            500 |       193 |
| `chasencars`                      |                       661 |            550 |       220 |
| `weberbrothers`                   |                     5,760 |          5,000 |     1,920 |
| `oemgarage`                       |                       239 |            200 |        79 |
| `hagerman`                        |                         5 |              5 |         1 |
| `kandr`                           |                        48 |             40 |        16 |
| `jimsimport`                      |                     3,649 |          3,000 |     1,216 |
| `lonestarimports`                 |                     2,531 |          2,000 |       843 |
| `alshned`                         |                        41 |             35 |        13 |
| `hollanderstores`                 |                    70,439 |         18,638 |    23,463 |
| `cstruck`                         |                        59 |             50 |        19 |
| `heavytruckparts`                 |                       838 |            700 |       277 |
| `beavers`                         |                       278 |            240 |        92 |
| `indianriver`                     |                     1,049 |            900 |       349 |
| `army`                            |                       231 |            200 |        77 |
| `pullsavewa`                      |                     2,065 |          1,800 |       688 |
| `littleton`                       |                     1,079 |            900 |       359 |
| `michigantruck`                   |                       173 |            150 |        57 |
| `joliet`                          |                     1,392 |          1,200 |       464 |
| `alln1`                           |                     1,093 |            900 |       364 |
| `grandpajohns`                    |                       636 |            500 |       212 |
| `pickers`                         |                     1,928 |            450 |       642 |
| `pipes`                           |                       535 |            500 |       178 |
| `uwrench`                         |                     1,121 |          1,000 |       373 |
| `millerstown`                     |                     1,087 |            900 |       362 |
| `pickapartva`                     |                     7,422 |          6,500 |     2,474 |
| `mccauley`                        |                        24 |             20 |         8 |
| `rustyhook`                       |                        25 |             20 |         8 |
| `aviation`                        |                     2,326 |          2,000 |       775 |
| `chaz`                            |                     1,063 |            900 |       354 |
| `citymotors`                      |                       171 |            150 |        57 |
| `awap`                            |                       183 |            160 |        61 |
| `clearsalvage`                    |                       177 |            150 |        59 |
| `aplus`                           |                     1,222 |          1,000 |       407 |
| `central`                         |                     5,957 |          5,000 |     1,985 |
| `coutu`                           |                     1,254 |          1,000 |       418 |
| `kodak`                           |                        38 |             30 |        12 |
| `six03`                           |                       973 |            800 |       324 |
| `rohner`                          |                       286 |            240 |        95 |
| `pratt`                           |                     5,931 |          5,000 |     1,977 |
| `cars4parts`                      |                        71 |             56 |        24 |
| `meeks`                           |                     1,415 |          1,200 |       471 |
| `brandywine`                      |                     1,807 |          1,500 |       602 |
| `rmmdtp`                          |                       103 |             80 |        34 |
| `nvpap`                           |                     3,278 |          2,500 |     1,092 |
| `pontiac`                         |                     1,307 |          1,000 |       435 |
| `aero`                            |                       130 |            100 |        43 |
| `hawaiiparts`                     |                        44 |             35 |        14 |
| `modernmuscle`                    |                       347 |            300 |       115 |
| `allied`                          |                     2,507 |          2,000 |       835 |
| `byot`                            |                     5,330 |          4,350 |     1,775 |
| `vinplus`                         |                     7,621 |          5,650 |     2,498 |
| `northwest`                       |                     6,688 |          5,500 |     2,229 |
| `calton`                          |                    12,549 |         11,000 |     4,183 |
| `urgiis`                          |                    70,704 |         40,835 |    23,561 |
| `cars4parts/heyworth`             |                        69 |             55 |        23 |

Harry's, Budget, Big D, Idaho Falls, Speedy's and the recent URG additions already have suitable floors. RTP retains its existing 1,000-donor floor for a 3,195-donor census. One-third floors remain sanity checks; complete enumeration is still required.

November 17 west/plains additions run under the same enabled Hollander source:
A-1 Auto Recyclers NM (993 accepted, floor 331), Kramer's NE (5, floor 1),
Horseshoe WA (33, floor 11), Midwest OK (221, floor 73). These new yards had no
prior floor. See [qualification and request budget](provider-coverage-west-plains.md).
