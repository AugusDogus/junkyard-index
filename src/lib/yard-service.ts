import type { IngestionSource } from "./ingestion-source";

export type YardService =
  | { kind: "self_service" }
  | { kind: "full_service" }
  | { kind: "both" }
  | { kind: "unknown"; reason: string };

const selfService: YardService = { kind: "self_service" };
const fullService: YardService = { kind: "full_service" };
const both: YardService = { kind: "both" };

// Evidence and the reviewed location census: docs/runbooks/yard-service-classification.md.
// Source-wide rules apply to the ingested inventory, not every business an operator owns.
const sourceDefaults: Record<IngestionSource, YardService> = {
  pyp: selfService, // Evidence: yard-service-classification.md#pyp
  pullapart: selfService, // Evidence: yard-service-classification.md#pullapart
  upullitne: selfService, // Evidence: yard-service-classification.md#upullitne
  upullitdavie: selfService, // Evidence: yard-service-classification.md#upullitdavie
  gopullit: selfService, // Evidence: yard-service-classification.md#gopullit
  pullnsave: selfService, // Evidence: yard-service-classification.md#pullnsave
  tearapart: selfService, // Evidence: yard-service-classification.md#tearapart
  wrenchapart: selfService, // Evidence: yard-service-classification.md#wrenchapart
  upullrparts: selfService, // Evidence: yard-service-classification.md#upullrparts
  ipullupull: both, // Evidence: yard-service-classification.md#ipullupull
  upullitwa: selfService, // Evidence: yard-service-classification.md#upullitwa
  partsgalore: selfService, // Evidence: yard-service-classification.md#partsgalore
  rtp: selfService, // Evidence: yard-service-classification.md#rtp
  nvpap: selfService, // Evidence: yard-service-classification.md#nvpap
  pontiac: selfService, // Evidence: yard-service-classification.md#pontiac
  aero: both, // Evidence: yard-service-classification.md#aero
  vanderhaags: fullService, // Evidence: yard-service-classification.md#vanderhaags
  chesterfield: both, // Evidence: yard-service-classification.md#chesterfield
  utpap: selfService, // Evidence: yard-service-classification.md#utpap
  tritown: selfService, // Evidence: yard-service-classification.md#tritown
  whitebradstreet: fullService, // Evidence: yard-service-classification.md#whitebradstreet
  midway: selfService, // Evidence: yard-service-classification.md#midway
  rightway: selfService, // Evidence: yard-service-classification.md#rightway
  ddauto: selfService, // Evidence: yard-service-classification.md#ddauto
  rivervalley: fullService, // Evidence: yard-service-classification.md#rivervalley
  fenix: selfService, // Evidence: yard-service-classification.md#fenix
  importapart: fullService, // Evidence: yard-service-classification.md#importapart
  army: selfService, // Evidence: yard-service-classification.md#army
  idipull: selfService, // Evidence: yard-service-classification.md#idipull
  bigd: selfService, // Evidence: yard-service-classification.md#bigd
  pullsavewa: selfService, // Evidence: yard-service-classification.md#pullsavewa
  littleton: selfService, // Evidence: yard-service-classification.md#littleton
  michigantruck: fullService, // Evidence: yard-service-classification.md#michigantruck
  joliet: selfService, // Evidence: yard-service-classification.md#joliet
  alln1: selfService, // Evidence: yard-service-classification.md#alln1
  grandpajohns: selfService, // Evidence: yard-service-classification.md#grandpajohns
  pickers: selfService, // Evidence: yard-service-classification.md#pickers
  pipes: selfService, // Evidence: yard-service-classification.md#pipes
  uwrench: selfService, // Evidence: yard-service-classification.md#uwrench
  millerstown: selfService, // Evidence: yard-service-classification.md#millerstown
  pickapartva: both, // Evidence: yard-service-classification.md#pickapartva
  mccauley: {
    kind: "unknown",
    reason:
      "McCauley’s lists parts vehicles but does not say who removes the parts; “Pick a part” alone does not establish customer access.",
  }, // Evidence: yard-service-classification.md#mccauley
  rustyhook: {
    kind: "unknown",
    reason:
      "Rusty Hook lists donors and loose parts but does not identify customer pulling or staff removal at its Pittsburgh yard.",
  }, // Evidence: yard-service-classification.md#rustyhook
  aviation: fullService, // Evidence: yard-service-classification.md#aviation
  chaz: fullService, // Evidence: yard-service-classification.md#chaz
  citymotors: fullService, // Evidence: yard-service-classification.md#citymotors
  awap: fullService, // Evidence: yard-service-classification.md#awap
  clearsalvage: both, // Evidence: yard-service-classification.md#clearsalvage
  aplus: fullService, // Evidence: yard-service-classification.md#aplus
  central: fullService, // Evidence: yard-service-classification.md#central
  northwest: {
    kind: "unknown",
    reason:
      "Northwest’s qualification establishes its Anchorage donors, but no explicit service model was found and the official website did not resolve.",
  }, // Evidence: yard-service-classification.md#northwest
  coutu: fullService, // Evidence: yard-service-classification.md#coutu
  kodak: fullService, // Evidence: yard-service-classification.md#kodak
  six03: fullService, // Evidence: yard-service-classification.md#six03
  rohner: {
    kind: "unknown",
    reason:
      "Rohner’s sells parts and lists part-out vehicles, but the reviewed pages do not establish who removes parts or whether the yard admits self-service customers.",
  }, // Evidence: yard-service-classification.md#rohner
  pratt: fullService, // Evidence: yard-service-classification.md#pratt
  cars4parts: {
    kind: "unknown",
    reason:
      "Carz R Us 1 has two yards; Heyworth’s “You Pull / We Pull” donor does not prove the service model at Armington.",
  }, // Evidence: yard-service-classification.md#cars4parts
  meeks: selfService, // Evidence: yard-service-classification.md#meeks
  brandywine: selfService, // Evidence: yard-service-classification.md#brandywine
  rmmdtp: fullService, // Evidence: yard-service-classification.md#rmmdtp
  calton: fullService, // Evidence: yard-service-classification.md#calton
  bigtruckpage: fullService, // Evidence: yard-service-classification.md#bigtruckpage
  speedys: fullService, // Evidence: yard-service-classification.md#speedys
  sandw: selfService, // Evidence: yard-service-classification.md#sandw
  denton: fullService, // Evidence: yard-service-classification.md#denton
  beavers: fullService, // Evidence: yard-service-classification.md#beavers
  indianriver: selfService, // Evidence: yard-service-classification.md#indianriver
  scotts: fullService, // Evidence: yard-service-classification.md#scotts
  oem: fullService, // Evidence: yard-service-classification.md#oem
  dutchers: fullService, // Evidence: yard-service-classification.md#dutchers
  alsauto: fullService, // Evidence: yard-service-classification.md#alsauto
  chasencars: selfService, // Evidence: yard-service-classification.md#chasencars
  weberbrothers: fullService, // Evidence: yard-service-classification.md#weberbrothers
  hawaiiparts: fullService, // Evidence: yard-service-classification.md#hawaiiparts
  modernmuscle: fullService, // Evidence: yard-service-classification.md#modernmuscle
  carsandparts: fullService, // Evidence: yard-service-classification.md#carsandparts
  spartan: fullService, // Evidence: yard-service-classification.md#spartan
  oemgarage: fullService, // Evidence: yard-service-classification.md#oemgarage
  hagerman: fullService, // Evidence: yard-service-classification.md#hagerman
  kandr: fullService, // Evidence: yard-service-classification.md#kandr
  jimsimport: fullService, // Evidence: yard-service-classification.md#jimsimport
  lonestarimports: fullService, // Evidence: yard-service-classification.md#lonestarimports
  alshned: fullService, // Evidence: yard-service-classification.md#alshned
  cstruck: fullService, // Evidence: yard-service-classification.md#cstruck
  heavytruckparts: fullService, // Evidence: yard-service-classification.md#heavytruckparts
  allied: fullService, // Evidence: yard-service-classification.md#allied
  byot: selfService, // Evidence: yard-service-classification.md#byot
  harrys: selfService, // Evidence: yard-service-classification.md#harrys
  budget: selfService, // Evidence: yard-service-classification.md#budget
  row52: {
    kind: "unknown",
    reason:
      "No reviewed service evidence for this row52 location code; review the physical yard before labeling it.",
  }, // Evidence: yard-service-classification.md#row52
  autorecycler: {
    kind: "unknown",
    reason:
      "No reviewed service evidence for this autorecycler location code; review the physical yard before labeling it.",
  }, // Evidence: yard-service-classification.md#autorecycler
  hollanderstores: {
    kind: "unknown",
    reason:
      "No reviewed service evidence for this hollanderstores location code; review the physical yard before labeling it.",
  }, // Evidence: yard-service-classification.md#hollanderstores
  vinplus: {
    kind: "unknown",
    reason:
      "No reviewed service evidence for this vinplus location code; review the physical yard before labeling it.",
  }, // Evidence: yard-service-classification.md#vinplus
  urgiis: {
    kind: "unknown",
    reason:
      "No reviewed service evidence for this urgiis location code; review the physical yard before labeling it.",
  }, // Evidence: yard-service-classification.md#urgiis
};

// Unresolved independent yards keep the source's unknown default. Their individual
// reasons are recorded in the evidence census rather than duplicated here.
const yardOverrides: Partial<
  Record<IngestionSource, ReadonlyMap<string, YardService>>
> = {
  // Evidence: docs/runbooks/yard-service-classification.md#autorecycler, by exact location code.
  autorecycler: new Map<string, YardService>([
    [
      "1348695171700984260__LOOKUP__1638984482131x412759042204631040",
      selfService,
    ], // samson-auto-salvage
    [
      "1348695171700984260__LOOKUP__1675881492565x169963290114654200",
      selfService,
    ], // prestige-pull-your-part-houston-tx
    [
      "1348695171700984260__LOOKUP__1707334416803x326449347354427400",
      selfService,
    ], // auto-parts-u-pull-nc
    [
      "1348695171700984260__LOOKUP__1714697915708x632629276791537700",
      selfService,
    ], // l-and-l-u-pull
    [
      "1348695171700984260__LOOKUP__1716932435477x905965313898837800",
      selfService,
    ], // ez-pull-n-pay-atlanta
    [
      "1348695171700984260__LOOKUP__1716935782717x242757159615917020",
      selfService,
    ], // ez-pull-n-pay-stockbridge
    [
      "1348695171700984260__LOOKUP__1716935856751x885196538023069600",
      selfService,
    ], // ez-pull-n-pay-montgomery
    [
      "1348695171700984260__LOOKUP__1716935969945x252386320604966800",
      selfService,
    ], // ez-pull-n-pay-warner-robins
    ["1348695171700984260__LOOKUP__1723480416579x725386772121473500", both], // a-a-auto-recycling
    [
      "1348695171700984260__LOOKUP__1726602417880x199387504054651780",
      selfService,
    ], // ez-pull-n-pay-columbus
    [
      "1348695171700984260__LOOKUP__1729734770456x874069861131576600",
      selfService,
    ], // foss-jacksonville
    [
      "1348695171700984260__LOOKUP__1729734770949x413620195323321400",
      selfService,
    ], // foss-winston-salem
    [
      "1348695171700984260__LOOKUP__1729734771363x364108105935208260",
      selfService,
    ], // foss-wilson
    [
      "1348695171700984260__LOOKUP__1729734771767x924341006048041200",
      selfService,
    ], // foss-havelock
    [
      "1348695171700984260__LOOKUP__1729734772623x937910381321392900",
      selfService,
    ], // foss-la-grange
    [
      "1348695171700984260__LOOKUP__1729734773060x748896575440458000",
      selfService,
    ], // foss-recycling
    [
      "1348695171700984260__LOOKUP__1734113947567x255782702476457400",
      selfService,
    ], // auto-parts-u-pull-shelby-nc
    [
      "1348695171700984260__LOOKUP__1745433028520x989978576556271200",
      selfService,
    ], // ez-pull-n-pay-decatur
    [
      "1348695171700984260__LOOKUP__1780608885295x623625493214308200",
      selfService,
    ], // ez-pull-n-pay-birmingham
    ["ario:1d432bd0-a24f-4b80-922a-a26aa5bd82cd", selfService], // parts-you-pull-amite-la
    ["ario:211f79c5-1032-4159-aae2-f21abf6d8d49", selfService], // wilberts-u-pull-it-williamson-ny
    ["ario:370e9a2c-5ec6-461f-944c-7bcf059ecfa9", selfService], // cash-n-carry-pull-your-part-savannah-ga
    ["ario:5c1156bd-0690-4e5b-89bc-381015aae45a", selfService], // milliron-auto-parts-mansfield-oh
    ["ario:6ee4e7ab-e8dc-4a55-a4c7-cc9d0caa9542", selfService], // wilberts-u-pull-it-bath-ny
    ["ario:81b46a86-d0de-4acd-ba52-9182b4393e78", selfService], // wilberts-u-pull-it-elma-ny
    ["ario:9e650335-4efb-4664-ba19-b4f22a0f1775", both], // cfc-recycling
    ["ario:a3d2b44f-54d5-4d05-93f2-75547f462d91", selfService], // roberts-parts-u-pick-moffett-ok
    ["ario:a74441d5-8fb9-4bde-a762-ccd5b0f62785", selfService], // youngstown-u-pull-it-youngstown-oh
    ["ario:bae5ae1b-6417-48f2-8e04-342b3e23293a", selfService], // smith-auto-inc-self-serve-pawnee-city-ne
    ["ario:d08c2971-b885-41d7-a323-b92ddc6aa25d", selfService], // barry-s-u-pull-it-theodore-al
  ]),
  // Evidence: docs/runbooks/yard-service-classification.md#cars4parts, by exact location code.
  cars4parts: new Map<string, YardService>([
    ["heyworth", both], // Carz R Us 1
  ]),
  // Evidence: docs/runbooks/yard-service-classification.md#hollanderstores, by exact location code.
  hollanderstores: new Map<string, YardService>([
    ["aaautosalvage", fullService], // AA Auto Salvage
    ["allsmallauto", fullService], // Midvale All Small Auto
    ["bobbysauto", fullService], // Bobby's Auto Parts
    ["champion", both], // Champion Auto Parts
    ["kirchhaynautopa", fullService], // Kirchhayn Auto Parts
    ["lamarautosalvag", fullService], // Lamar Auto Salvage
    ["macksautoparts", fullService], // Mack's Auto Parts
    ["mkauto", fullService], // M&K Used Auto Parts
    ["mstrecycling", fullService], // MST Recycling
    ["mwas", fullService], // Midwest Auto Parts
    ["northverdeauto", fullService], // North Verde Auto Salvage
    ["nwaupiautoparts", both], // NWA U-Pull-It
    ["pascoauto", fullService], // Pasco Auto Wrecking
    ["pauldemin", selfService], // Paul's Auto Yard - DeMotte
    ["paulelkin", selfService], // Paul's Auto Yard - Elkhart North
    ["paullogin", selfService], // Paul's Auto Yard - Logansport
    ["paulmerin", selfService], // Paul's Auto Yard - Merrillville
    ["paulsfwin", selfService], // Paul's Auto Yard - Fort Wayne
    ["paulsknox", selfService], // Paul's Auto Yard - Knox
    ["paulslkin", selfService], // Paul's Auto Yard - Lake Station
    ["paulsouin", selfService], // Paul's Auto Yard - South Bend
    ["paulswvin", selfService], // Paul's Auto Yard - Westville
    ["rainbowauto", fullService], // Rainbow Auto Salvage
    ["spilmanautopart", fullService], // Spilman Auto Parts
    ["strickerauto", fullService], // Stricker Auto Parts
    ["sunlineparts", fullService], // Sun Line
  ]),
  // Evidence: docs/runbooks/yard-service-classification.md#row52, by exact location code.
  row52: new Map<string, YardService>(
    [
      "100",
      "102",
      "10677",
      "10797",
      "10798",
      "10818",
      "110",
      "116",
      "380",
      "39",
      "40",
      "43",
      "44",
      "45",
      "46",
      "48",
      "49",
      "50",
      "51",
      "52",
      "53",
      "54",
      "55",
      "56",
      "57",
      "59",
      "61",
      "63",
      "65",
      "66",
      "67",
      "68",
      "69",
      "71",
      "73",
      "75",
      "76",
      "78",
      "79",
      "81",
      "82",
      "83",
      "84",
      "85",
      "88",
      "89",
      "95",
      "96",
      "97",
      "98",
      "99",
    ].map((code) => [code, selfService]),
  ),
  // Evidence: docs/runbooks/yard-service-classification.md#urgiis, by exact location code.
  urgiis: new Map<string, YardService>([
    ["ace-iowa", fullService], // Ace Auto Recyclers
    ["ace-st-paul", fullService], // Ace Auto Parts
    ["az", fullService], // A-Z Auto Parts & Auto Sales
    ["bishops", fullService], // Bishop's Auto Parts
    ["central-nh", fullService], // Central Auto Recyclers
    ["chucks", fullService], // Chuck's Auto Salvage
    ["eagle-martinsburg", fullService], // Eagle Auto Parts
    ["junior-sinn", fullService], // Junior Sinn Auto Parts
    ["lentini-port-murray", fullService], // Lentini Auto Salvage - Port Murray
    ["lentini-ringoes", fullService], // Lentini Auto Salvage - Ringoes
    ["linders", fullService], // Linder's Inc
    ["mars", fullService], // Mars Auto Parts & Engine Swaps
    ["premier", fullService], // Premier Auto & Truck Parts
    ["united", fullService], // United Auto Recyclers
  ]),
  // Evidence: docs/runbooks/yard-service-classification.md#vinplus, by exact location code.
  vinplus: new Map<string, YardService>([
    ["hinesville", selfService], // YourPart (SA Recycling)
    ["indianapolis", selfService], // Indy U-Pull-It
    ["killeen", selfService], // 195 Used Auto Parts
    ["lubbock", selfService], // Pick Ur Part
    ["ryans", selfService], // Ryan's Pick-A-Part
    ["sterling-heights", selfService], // US Auto Supply of Sterling Heights
  ]),
};

export const YardService = {
  /** Resolve only registered sources and exact, case-sensitive canonical location codes. */
  resolve(source: IngestionSource, locationCode: string): YardService {
    return yardOverrides[source]?.get(locationCode) ?? sourceDefaults[source];
  },
} as const;
