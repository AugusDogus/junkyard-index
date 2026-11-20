import type { IngestionSource } from "~/lib/ingestion-source";

/** How a test proves a source's real finished cursor passes terminal validation. */
export type TerminalCursorFixture =
  /** The cursor has no completion marker; validation trusts connector status. */
  | { kind: "connector-status" }
  /** A finished cursor in its persisted `next_cursor` wire form. */
  | { kind: "wire"; terminal: string }
  /**
   * The finished cursor carries the crawl's evidence and is too large to
   * commit, so this connector test asserts it where the connector returns it.
   */
  | { kind: "connector-test"; file: string };

/**
 * Real finished cursors, as each connector returns them on a complete crawl.
 * Checksummed ones came from the connector's own tests or a successful
 * production run. When a cursor contract or scope changes, replace the entry
 * with the serialized final cursor of that connector's test crawl.
 */
export const TERMINAL_CURSOR_FIXTURES: {
  [Source in IngestionSource]: TerminalCursorFixture;
} = {
  row52: { kind: "connector-status" },
  pyp: {
    kind: "wire",
    terminal:
      '{"storeCodes":["1100","1101","1102","1103","1104","1105","1106","1107","1108","1109","1110","1111","1112","1113","1114","1115","1116","1117","1118","1119"],"storeIndex":20,"page":0}',
  },
  autorecycler: {
    kind: "wire",
    terminal:
      '{"phase":"complete","freshness":{"asOf":1795000000000,"legacy":{},"eligibleYards":["1"]}}',
  },
  pullapart: { kind: "connector-status" },
  upullitne: { kind: "connector-status" },
  upullitdavie: {
    kind: "wire",
    terminal:
      '{"page":4,"totalPages":3,"totalCount":250,"pageSize":100,"recordsProcessed":250,"recordsRejected":0}',
  },
  gopullit: { kind: "connector-status" },
  pullnsave: { kind: "connector-status" },
  tearapart: { kind: "connector-status" },
  wrenchapart: { kind: "connector-status" },
  upullrparts: {
    kind: "wire",
    terminal: '{"phase":"complete","storesSeen":[1,2,3]}',
  },
  ipullupull: { kind: "wire", terminal: "1" },
  upullitwa: { kind: "wire", terminal: '{"phase":"complete"}' },
  partsgalore: { kind: "wire", terminal: "1" },
  rtp: { kind: "wire", terminal: '{"phase":"complete"}' },
  nvpap: { kind: "wire", terminal: '{"phase":"complete"}' },
  pontiac: { kind: "wire", terminal: '{"phase":"complete"}' },
  aero: { kind: "wire", terminal: '{"phase":"complete"}' },
  vanderhaags: {
    kind: "wire",
    terminal:
      '{"phase":"complete","census":{"contract":"detail-census-v2","scope":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","startedAt":0,"reverification":{"day":0,"paths":[]},"entries":[],"checksum":"192b80f5"}}',
  },
  chesterfield: { kind: "wire", terminal: '{"phase":"complete"}' },
  utpap: { kind: "wire", terminal: '{"phase":"complete"}' },
  tritown: { kind: "wire", terminal: '{"phase":"complete"}' },
  whitebradstreet: { kind: "wire", terminal: '{"phase":"complete"}' },
  midway: { kind: "wire", terminal: '{"phase":"complete"}' },
  rightway: { kind: "wire", terminal: '{"phase":"complete"}' },
  ddauto: { kind: "wire", terminal: '{"phase":"complete"}' },
  rivervalley: { kind: "wire", terminal: '{"phase":"complete"}' },
  fenix: { kind: "connector-test", file: "fenix-connector.test.ts" },
  importapart: { kind: "wire", terminal: '{"version":1,"phase":"complete"}' },
  army: { kind: "wire", terminal: '{"phase":"complete"}' },
  idipull: { kind: "wire", terminal: '{"phase":"complete"}' },
  bigd: { kind: "wire", terminal: '{"version":1,"phase":"complete"}' },
  pullsavewa: { kind: "wire", terminal: '{"phase":"complete"}' },
  littleton: { kind: "wire", terminal: '{"phase":"complete"}' },
  michigantruck: { kind: "wire", terminal: '{"phase":"complete"}' },
  joliet: { kind: "wire", terminal: '{"phase":"complete"}' },
  alln1: { kind: "wire", terminal: '{"phase":"complete"}' },
  grandpajohns: { kind: "wire", terminal: '{"phase":"complete"}' },
  pickers: { kind: "wire", terminal: '{"version":2,"phase":"complete"}' },
  pipes: { kind: "connector-test", file: "pipes-connector.test.ts" },
  uwrench: { kind: "wire", terminal: '{"phase":"complete"}' },
  millerstown: { kind: "wire", terminal: '{"phase":"complete"}' },
  pickapartva: { kind: "wire", terminal: '{"phase":"complete"}' },
  mccauley: { kind: "wire", terminal: '{"version":1,"phase":"complete"}' },
  rustyhook: { kind: "connector-test", file: "rustyhook-connector.test.ts" },
  aviation: {
    kind: "wire",
    terminal: '{"source":"aviation","version":1,"phase":"complete"}',
  },
  chaz: {
    kind: "wire",
    terminal: '{"source":"chaz","version":1,"phase":"complete"}',
  },
  citymotors: {
    kind: "wire",
    terminal: '{"source":"citymotors","version":1,"phase":"complete"}',
  },
  awap: {
    kind: "wire",
    terminal: '{"source":"awap","version":1,"phase":"complete"}',
  },
  clearsalvage: {
    kind: "wire",
    terminal: '{"source":"clearsalvage","version":1,"phase":"complete"}',
  },
  aplus: {
    kind: "wire",
    terminal: '{"source":"aplus","version":1,"phase":"complete"}',
  },
  central: {
    kind: "wire",
    terminal: '{"source":"central","version":1,"phase":"complete"}',
  },
  northwest: {
    kind: "wire",
    terminal: '{"source":"northwest","version":1,"phase":"complete"}',
  },
  coutu: {
    kind: "wire",
    terminal: '{"source":"coutu","version":1,"phase":"complete"}',
  },
  kodak: {
    kind: "wire",
    terminal: '{"source":"kodak","version":1,"phase":"complete"}',
  },
  six03: {
    kind: "wire",
    terminal: '{"source":"six03","version":1,"phase":"complete"}',
  },
  rohner: { kind: "connector-test", file: "rohner-connector.test.ts" },
  pratt: {
    kind: "wire",
    terminal:
      '{"source":"pratt","version":1,"scope":"d3fd1723c8a837457e6969f7c2dd420bf2cceec4166da4814a68d2a1ce121e2c","checksum":"4b3eb1c3ae065c141f04fbf7ad9051495a18d9bbb3d8d852c86dfbd778407ec4","requests":518,"bytes":80000000,"phase":"complete"}',
  },
  cars4parts: {
    kind: "wire",
    terminal:
      '{"source":"cars4parts","version":1,"scope":"9496b7b6b4df695666f5a8439b9c45001c6ff9f5e079e34df02a9ec43ebcd3b5","checksum":"04b823207332aeab10459519e8efd9a963ffab8d69c69b1317ec63161dca5676","requests":5,"bytes":937904,"phase":"complete"}',
  },
  meeks: { kind: "wire", terminal: '{"phase":"complete"}' },
  brandywine: { kind: "connector-test", file: "brandywine-connector.test.ts" },
  rmmdtp: { kind: "connector-test", file: "rmmdtp-connector.test.ts" },
  calton: {
    kind: "wire",
    terminal:
      '{"source":"calton","version":1,"scope":"b1b998804d79f7187b8f81d312abf2739550d81a14c3676b611ee67bad077f08","checksum":"75a76d23d12429507cc3eafd7dd6270f8b937a4b4e190278bc99d876ba9b26eb","requests":4,"bytes":40216,"phase":"complete"}',
  },
  bigtruckpage: { kind: "wire", terminal: '{"version":1,"phase":"complete"}' },
  speedys: { kind: "connector-test", file: "speedys-connector.test.ts" },
  sandw: {
    kind: "wire",
    terminal:
      '{"source":"sandw","version":1,"scope":"d51b4857d8da1b3c841a605276b901bf68e0611acf6f82bd246fbddd4597721a","phase":"complete","checksum":"532013bbacb8470d4da368a8ede9f2c132a8a6d7789ab72ae044c4fb9764fe40"}',
  },
  denton: { kind: "connector-test", file: "denton-connector.test.ts" },
  beavers: {
    kind: "wire",
    terminal: '{"source":"beavers","version":1,"phase":"complete"}',
  },
  indianriver: {
    kind: "wire",
    terminal:
      '{"source":"indianriver","version":1,"scope":"74853e2fe725c098f2799ace3515bc1ea4513d2d24b8744b55b23f248fe5f51f","phase":"complete","checksum":"c72dd9e9bc9743b35e0661059c9eefaa3399dbaaa983931700afb8299dfc4cfc"}',
  },
  scotts: {
    kind: "wire",
    terminal: '{"source":"scotts","version":1,"phase":"complete"}',
  },
  oem: {
    kind: "wire",
    terminal:
      '{"version":1,"requests":8,"bytes":8262,"state":{"phase":"complete"},"checksum":"079302ea565a33c97a48b0c596aea6cfe01faad0b6456bafc4d21c558bb279c4"}',
  },
  dutchers: {
    kind: "wire",
    terminal:
      '{"source":"dutchers","version":1,"scopeKey":"548197ac34f5b5ebc0cf9c5222cca1e7cd7d46f327e4ab59c668c04f1deaa8ea","startedAt":1795204811159,"phase":"complete","checksum":"b1568085bf63042490cfd2fafde6e5c83f043112ca42ad01a0cc6be62368f53d"}',
  },
  alsauto: { kind: "connector-test", file: "alsauto-connector.test.ts" },
  chasencars: {
    kind: "wire",
    terminal:
      '{"source":"chasencars","version":1,"scope":"4a7014893778ed4c68a0cd5136c085477227d7b20360a779cb8568cc56ebfb86","previousAcceptedCount":null,"bytes":1903014,"phase":"complete","requests":6,"checksum":"4cbad46d15fa35435b84dfda5e67faec52d54792c5df31f8b86b075c8946debb"}',
  },
  weberbrothers: {
    kind: "connector-test",
    file: "weberbrothers-connector.test.ts",
  },
  hawaiiparts: {
    kind: "wire",
    terminal:
      '{"phase":"complete","source":"hawaiiparts","version":1,"scope":"58c3a69fb70315aea2e2b7a14b3f6d220630e087757b3df18adc231d92370243","checksum":"e8516b7f66c6db13a24d239561071c37f243ba6f8a94527041831472fb66be2b"}',
  },
  modernmuscle: {
    kind: "wire",
    terminal:
      '{"phase":"complete","source":"modernmuscle","version":1,"scope":"073b138a8fab1f37856ff1faa8ed139c4ebf11aef080c51a489df269e39e5ac5","checksum":"2457122f28e6af3c8ce297bda1ca7c8a6a2a5cd14f96aae7b9ace6f9d87cc783"}',
  },
  carsandparts: {
    kind: "wire",
    terminal:
      '{"phase":"complete","source":"carsandparts","version":1,"scope":"a284ce132338385da07e2ee09579a9269becfe844b866a6d88b5930739c4d84a","checksum":"7632043515e022131ec8141f084243c737258a43acd5b6f55eaf324a113e19d6"}',
  },
  spartan: {
    kind: "wire",
    terminal:
      '{"phase":"complete","source":"spartan","version":1,"scope":"956a52392f0941b5420950fd32adb17b9b3a917fc5a56d50108f3e4c42c16b17","checksum":"02a1e01d7433105ed8e5142722e15f60a38a84b32d184813ece9d4647121f452"}',
  },
  oemgarage: {
    kind: "wire",
    terminal:
      '{"source":"oemgarage","version":1,"scope":"ed46e3d3a842521dad6b2b96f2ea57bff59929358097687c395fe6559f0cc186","phase":"complete","checksum":"3c5e9ad27646da0e28e8c862ef08e85a45bf43cbe324fa69cfe122f450583a6b"}',
  },
  hagerman: { kind: "connector-test", file: "hagerman-connector.test.ts" },
  kandr: {
    kind: "wire",
    terminal:
      '{"source":"kandr","version":1,"scope":"c4fe85b3de8c38386fcf03eac39ecc4280ce154d3975fbccfe0bb5d28ea48bcc","checksum":"1213594410d60e67e98e8a5ae436a657ae67a91afa5ba2d21ffa8b5812621f15","requests":54,"bytes":8022942,"phase":"complete"}',
  },
  jimsimport: {
    kind: "wire",
    terminal:
      '{"source":"jimsimport","version":1,"scope":"0c5911015d32f22e8c7cfd15abe430f811c09f97ab68e55cef9125f3010c80cf","requests":370,"bytes":52516040,"phase":"complete","checksum":"2b009ca041206fe0737407a742c765b3b42ec82bd00e998f40240e453e0f16a5"}',
  },
  lonestarimports: {
    kind: "wire",
    terminal:
      '{"source":"lonestarimports","version":1,"scope":"b4d46f91ed703536fd9432fba75023c3758ca83e79e284d2a5e7c165735dbc14","previousAcceptedCount":null,"requests":264,"bytes":3146852,"phase":"complete","totalPages":128,"checksum":"c387dca9fd6b660549442bca4ec70107e8b431fe02f433c3ac4523a42940320d"}',
  },
  alshned: { kind: "connector-test", file: "alshned-connector.test.ts" },
  hollanderstores: {
    kind: "wire",
    terminal:
      '{"source":"hollanderstores","version":2,"scope":"3548ddf2","phase":"complete","requests":547,"checksum":"08775259","statePath":null}',
  },
  cstruck: { kind: "connector-test", file: "cstruck-connector.test.ts" },
  heavytruckparts: {
    kind: "connector-test",
    file: "heavytruckparts-connector.test.ts",
  },
  allied: {
    kind: "wire",
    terminal:
      '{"source":"allied","version":1,"scope":"c53087b646518c33fa167cd371e609dc39ad104291f5b6e5aa2f7d13ead9488d","checksum":"fcefebc850f273cc8bf8d565a4833a47172679eb4f35886ae3402aa3d02ae7ad","requests":577,"bytes":90997735,"phase":"complete"}',
  },
  byot: { kind: "connector-test", file: "byot-connector.test.ts" },
  vinplus: { kind: "connector-test", file: "vinplus-connector.test.ts" },
  urgiis: {
    kind: "wire",
    terminal:
      '{"source":"urgiis","version":2,"scope":"1f44c8f8","startedAt":1,"asOf":1,"statePath":"ingestion-runs/next/urgiis/f6735335-28a9-470d-9247-7ce99d84d0d4.json.gz","stateHash":"offline-census","requests":0,"bytes":0,"completed":[{"code":"eagle","accepted":482},{"code":"linders","accepted":1091},{"code":"chuckran","accepted":1223},{"code":"united","accepted":4118},{"code":"ace-iowa","accepted":508},{"code":"lentini","accepted":1117},{"code":"dings","accepted":370},{"code":"bishops","accepted":1120},{"code":"ace-st-paul","accepted":1005},{"code":"chucks","accepted":867},{"code":"central-nh","accepted":825},{"code":"higgins","accepted":492},{"code":"premier","accepted":856},{"code":"junior-sinn","accepted":1104},{"code":"revolution","accepted":1728},{"code":"az","accepted":579},{"code":"lambert","accepted":2995},{"code":"norbs","accepted":2954},{"code":"mars","accepted":127},{"code":"stroud","accepted":1093}],"phase":"complete","checksum":"e1-e1d2c3bd"}',
  },
  harrys: {
    kind: "wire",
    terminal:
      '{"source":"harrys","version":1,"scope":"ad4a40de","phase":"complete","checksum":"2ae3c5f9"}',
  },
  budget: {
    kind: "wire",
    terminal:
      '{"source":"budget","version":1,"scope":"9ba31919","phase":"complete","checksum":"ae8b455d"}',
  },
};

/** Mid-crawl cursors for sources whose initial cursor is not representative. */
export const MID_CRAWL_CURSOR_FIXTURES: Partial<
  Record<IngestionSource, readonly string[]>
> = {
  pyp: [
    '{"storeCodes":["1100","1101","1102","1103","1104","1105","1106","1107","1108","1109","1110","1111","1112","1113","1114","1115","1116","1117","1118","1119"],"storeIndex":19,"page":3}',
  ],
  autorecycler: ['{"phase":"complete"}'],
  upullitdavie: [
    '{"page":2,"totalPages":3,"totalCount":250,"pageSize":100,"recordsProcessed":100,"recordsRejected":0}',
  ],
  upullrparts: [
    '{"phase":"crawl","location":"1","afterMake":"FORD","storesSeen":[1]}',
  ],
  vanderhaags: ['{"phase":"complete"}'],
};

/** A source's committed finished cursor, for tests that stage a successful run. */
export function terminalCursorWire(source: IngestionSource): string {
  const fixture = TERMINAL_CURSOR_FIXTURES[source];
  if (fixture.kind !== "wire")
    throw new Error(
      `${source} has no committed finished cursor (${fixture.kind}); stage a source with a wire fixture or build the cursor from its connector test.`,
    );
  return fixture.terminal;
}
