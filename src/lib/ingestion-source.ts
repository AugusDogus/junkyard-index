export const INGESTION_SOURCES = [
  "row52",
  "pyp",
  "autorecycler",
  "pullapart",
  "upullitne",
  "upullitdavie",
  "gopullit",
  "pullnsave",
  "tearapart",
  "wrenchapart",
  "upullrparts",
  "ipullupull",
  "upullitwa",
  "partsgalore",
  "rtp",
  "nvpap",
  "pontiac",
  "aero",
  "vanderhaags",
  "chesterfield",
  "utpap",
  "tritown",
  "whitebradstreet",
  "midway",
  "rightway",
  "ddauto",
  "rivervalley",
  "fenix",
  "importapart",
  "army",
  "idipull",
  "bigd",
  "pullsavewa",
  "littleton",
  "michigantruck",
  "joliet",
  "alln1",
  "grandpajohns",
  "pickers",
  "pipes",
  "uwrench",
  "millerstown",
  "pickapartva",
  "mccauley",
  "rustyhook",
  "aviation",
  "chaz",
  "citymotors",
  "awap",
  "clearsalvage",
  "aplus",
  "central",
  "northwest",
  "coutu",
  "kodak",
  "six03",
  "rohner",
  "pratt",
  "cars4parts",
  "meeks",
  "brandywine",
  "rmmdtp",
  "calton",
  "bigtruckpage",
  "speedys",
  "sandw",
  "denton",
  "beavers",
  "indianriver",
  "scotts",
  "oem",
  "dutchers",
  "alsauto",
  "chasencars",
  "weberbrothers",
  "hawaiiparts",
  "modernmuscle",
  "carsandparts",
  "spartan",
  "oemgarage",
  "hagerman",
  "kandr",
  "jimsimport",
  "lonestarimports",
  "alshned",
  "hollanderstores",
  "cstruck",
  "heavytruckparts",
  "allied",
  "byot",
  "vinplus",
  "urgiis",
  "harrys",
  "budget",
] as const;

export type IngestionSource = (typeof INGESTION_SOURCES)[number];

export const INGESTION_SOURCE_DISPLAY_NAMES = {
  row52: "Row52",
  pyp: "LKQ Pick Your Part",
  autorecycler: "AutoRecycler.io",
  pullapart: "Pull-A-Part / U-Pull-&-Pay",
  upullitne: "U Pull-It Nebraska",
  upullitdavie: "U Pull It Davie",
  gopullit: "GO Pull-It",
  pullnsave: "Pull-N-Save",
  tearapart: "Tear-A-Part",
  wrenchapart: "Wrench-A-Part",
  upullrparts: "U Pull R Parts",
  ipullupull: "iPull-uPull",
  upullitwa: "Washington U-Pull-It",
  partsgalore: "Parts Galore",
  rtp: "RTP Pick-A-Part",
  nvpap: "Nevada Pic-A-Part",
  pontiac: "U-Pull and Save Pontiac",
  aero: "Aero Auto Parts",
  vanderhaags: "Vander Haag’s",
  chesterfield: "Chesterfield Auto Parts",
  utpap: "Utah Pic-A-Part",
  tritown: "Tri Town Auto Salvage",
  whitebradstreet: "White & Bradstreet",
  midway: "Midway U Pull",
  rightway: "Rightway Auto Recycling",
  ddauto: "DD Auto & Salvage",
  rivervalley: "River Valley Truck Parts",
  fenix: "Fenix U-Pull",
  importapart: "Importapart",
  army: "Army's Auto Wrecking",
  idipull: "Idaho Falls I-Pull",
  bigd: "Big D Pick & Pull",
  pullsavewa: "Pull & Save Washington",
  littleton: "Littleton U-Pull-It",
  michigantruck: "Michigan Truck Parts",
  joliet: "Joliet U-Pull-It",
  alln1: "All-N-1 U Pull",
  grandpajohns: "Grandpa John’s Pick & Pull",
  pickers: "Pickers Self-Service Auto Parts",
  pipes: "Pipes U-Pull-It",
  uwrench: "Tri-State U-Wrench & Save",
  millerstown: "Millerstown Pic-A-Part",
  pickapartva: "Pick-A-Part Virginia",
  mccauley: "McCauley's Auto",
  rustyhook: "Rusty Hook Auto Salvage",
  aviation: "Aviation Auto Salvage",
  chaz: "Chaz's Used Auto Parts & Towing",
  citymotors: "City Motors",
  awap: "Alabama Wholesale Auto Parts",
  clearsalvage: "Clear Salvage",
  aplus: "A Plus Auto",
  central: "Central Auto Liquidators",
  northwest: "Northwest Auto Parts",
  coutu: "Truck Country",
  kodak: "Kodak Auto",
  six03: "603 Auto Salvage",
  rohner: "Rohner's Auto Parts",
  pratt: "Pratt's Auto Salvage",
  cars4parts: "Cars 4 Parts",
  meeks: "Meeks Pic-N-Pull",
  brandywine: "Brandywine U-Pull-It",
  rmmdtp: "Rocky Mountain Medium Duty Truck Parts",
  calton: "Calton Auto Parts Recyclers",
  bigtruckpage: "BigTruckPage",
  speedys: "Speedy's Transmission",
  sandw: "S&W Automotive Parts",
  denton: "Denton Auto Parts",
  beavers: "Beaver's Car Salvage",
  indianriver: "Indian River U-Pull-It",
  scotts: "Scott's Used Parts",
  oem: "OEM Auto Recyclers",
  dutchers: "Dutcher's Inc. Heavy Truck Division",
  alsauto: "Al's Auto Salvage",
  chasencars: "Chase N Cars",
  weberbrothers: "Weber Brothers Auto",
  hawaiiparts: "Hawaii Parts",
  modernmuscle: "Modern Muscle Salvage",
  carsandparts: "CarsAndPartsHub",
  spartan: "Spartan Auto",
  oemgarage: "oeM Garage",
  hagerman: "Hagerman",
  kandr: "K&R Truck Parts",
  jimsimport: "Jim's Import Auto Salvage",
  lonestarimports: "Lonestar Imports",
  alshned: "Alshned Auto Parts",
  hollanderstores: "Hollander Stores",
  cstruck: "C&S Truck Sales & Salvage",
  heavytruckparts: "HeavyTruckParts.net",
  allied: "Allied Auto Wrecking",
  byot: "BYOT Auto Parts",
  vinplus: "VinPlus app yards",
  urgiis: "Independent URG yards",
  harrys: "Harry's U-Pull It",
  budget: "Budget U Pull It",
} as const satisfies Record<IngestionSource, string>;

export function mapIngestionSources<Value>(
  transform: (source: IngestionSource) => Value,
): Record<IngestionSource, Value> {
  return {
    row52: transform("row52"),
    pyp: transform("pyp"),
    autorecycler: transform("autorecycler"),
    pullapart: transform("pullapart"),
    upullitne: transform("upullitne"),
    upullitdavie: transform("upullitdavie"),
    gopullit: transform("gopullit"),
    pullnsave: transform("pullnsave"),
    tearapart: transform("tearapart"),
    wrenchapart: transform("wrenchapart"),
    upullrparts: transform("upullrparts"),
    ipullupull: transform("ipullupull"),
    upullitwa: transform("upullitwa"),
    partsgalore: transform("partsgalore"),
    rtp: transform("rtp"),
    nvpap: transform("nvpap"),
    pontiac: transform("pontiac"),
    aero: transform("aero"),
    vanderhaags: transform("vanderhaags"),
    chesterfield: transform("chesterfield"),
    utpap: transform("utpap"),
    tritown: transform("tritown"),
    whitebradstreet: transform("whitebradstreet"),
    midway: transform("midway"),
    rightway: transform("rightway"),
    ddauto: transform("ddauto"),
    rivervalley: transform("rivervalley"),
    fenix: transform("fenix"),
    importapart: transform("importapart"),
    army: transform("army"),
    idipull: transform("idipull"),
    bigd: transform("bigd"),
    pullsavewa: transform("pullsavewa"),
    littleton: transform("littleton"),
    michigantruck: transform("michigantruck"),
    joliet: transform("joliet"),
    alln1: transform("alln1"),
    grandpajohns: transform("grandpajohns"),
    pickers: transform("pickers"),
    pipes: transform("pipes"),
    uwrench: transform("uwrench"),
    millerstown: transform("millerstown"),
    pickapartva: transform("pickapartva"),
    mccauley: transform("mccauley"),
    rustyhook: transform("rustyhook"),
    aviation: transform("aviation"),
    chaz: transform("chaz"),
    citymotors: transform("citymotors"),
    awap: transform("awap"),
    clearsalvage: transform("clearsalvage"),
    aplus: transform("aplus"),
    central: transform("central"),
    northwest: transform("northwest"),
    coutu: transform("coutu"),
    kodak: transform("kodak"),
    six03: transform("six03"),
    rohner: transform("rohner"),
    pratt: transform("pratt"),
    cars4parts: transform("cars4parts"),
    meeks: transform("meeks"),
    brandywine: transform("brandywine"),
    rmmdtp: transform("rmmdtp"),
    calton: transform("calton"),
    bigtruckpage: transform("bigtruckpage"),
    speedys: transform("speedys"),
    sandw: transform("sandw"),
    denton: transform("denton"),
    beavers: transform("beavers"),
    indianriver: transform("indianriver"),
    scotts: transform("scotts"),
    oem: transform("oem"),
    dutchers: transform("dutchers"),
    alsauto: transform("alsauto"),
    chasencars: transform("chasencars"),
    weberbrothers: transform("weberbrothers"),
    hawaiiparts: transform("hawaiiparts"),
    modernmuscle: transform("modernmuscle"),
    carsandparts: transform("carsandparts"),
    spartan: transform("spartan"),
    oemgarage: transform("oemgarage"),
    hagerman: transform("hagerman"),
    kandr: transform("kandr"),
    jimsimport: transform("jimsimport"),
    lonestarimports: transform("lonestarimports"),
    alshned: transform("alshned"),
    hollanderstores: transform("hollanderstores"),
    cstruck: transform("cstruck"),
    heavytruckparts: transform("heavytruckparts"),
    allied: transform("allied"),
    byot: transform("byot"),
    vinplus: transform("vinplus"),
    urgiis: transform("urgiis"),
    harrys: transform("harrys"),
    budget: transform("budget"),
  };
}

export function isIngestionSource(value: unknown): value is IngestionSource {
  return (
    typeof value === "string" &&
    INGESTION_SOURCES.some((source) => source === value)
  );
}

/**
 * Sources whose feed no longer reflects the yards' inventory. They are never
 * fetched, and every run withdraws their published vehicles through the usual
 * missing-then-delete reconciliation. They stay in INGESTION_SOURCES so their
 * stored rows still parse and their status reports stale.
 *
 * upullitne: U Pull-It Nebraska moved to YardConnect Pro, which lists no VINs.
 * Its old TAP endpoint still answers, frozen at early August 2026.
 *
 * brandywine: Brandywine U-Pull-It's site stopped updating in September 2020.
 * Its newest "Inventory Date" and its incoming-vehicles "Date Entered" are both
 * from then, so its listings no longer show what is in the yard.
 */
export const RETIRED_INGESTION_SOURCES: readonly IngestionSource[] = [
  "upullitne",
  "brandywine",
];

export function isRetiredIngestionSource(source: IngestionSource): boolean {
  return RETIRED_INGESTION_SOURCES.includes(source);
}

/** Ingestion days between a source's scheduled crawls. */
export type IngestionCadenceDays = 1 | 2 | 3;

/**
 * Sources crawled less often than daily, because each crawl costs too much
 * to repeat. Every other source is crawled daily.
 *
 * upullrparts: every crawl mints about 860 Turnstile tokens in a headful
 * Kernel browser (about $0.17 to $0.26 measured), so a daily crawl would cost
 * about $5 to $8 a month, Kernel's whole free credit; every third day keeps it
 * near $1.70 to $2.60.
 */
const INGESTION_SOURCE_CADENCES: Partial<
  Record<IngestionSource, IngestionCadenceDays>
> = { upullrparts: 3 };

export function ingestionSourceCadenceDays(
  source: IngestionSource,
): IngestionCadenceDays {
  return INGESTION_SOURCE_CADENCES[source] ?? 1;
}

/**
 * Scheduled runs a source may start on one ingestion day (manual runs from
 * /admin are not limited). Every source gets 3 except those listed.
 *
 * upullrparts: 1, because a failing crawl opens a new headful Kernel browser
 * for each chunk retry, and 3 failing runs a day cost about $0.40 to $1.10,
 * enough to spend Kernel's free credit that Big D and Northwest share.
 */
const INGESTION_SOURCE_MAX_ATTEMPTS_PER_DAY: Partial<
  Record<IngestionSource, number>
> = { upullrparts: 1 };

export function ingestionSourceMaxAttemptsPerDay(
  source: IngestionSource,
): number {
  return INGESTION_SOURCE_MAX_ATTEMPTS_PER_DAY[source] ?? 3;
}

/** The longest cadence of any source. */
export const MAX_INGESTION_CADENCE_DAYS =
  INGESTION_SOURCES.reduce<IngestionCadenceDays>((longest, source) => {
    const days = ingestionSourceCadenceDays(source);
    return days > longest ? days : longest;
  }, 1);

/** Sources that are still fetched: every source except the retired ones. */
export const ACTIVE_INGESTION_SOURCES: readonly IngestionSource[] =
  INGESTION_SOURCES.filter((source) => !isRetiredIngestionSource(source));
