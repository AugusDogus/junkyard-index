import { expect, test } from "bun:test";
import {
  SourceValidationPolicy,
  validateSourceSnapshot,
} from "./source-validation";
import { HOLLANDERSTORES_YARDS } from "./hollanderstores-yard-metadata";
import { hollanderstoresExpected } from "./hollanderstores-test-fixtures";

// Accepted counts from the committed qualification censuses, not live providers.
const censuses = [
  { source: "chesterfield", count: 2111 },
  { source: "utpap", count: 1727 },
  { source: "tritown", count: 470 },
  { source: "whitebradstreet", count: 382 },
  { source: "midway", count: 1827 },
  { source: "rightway", count: 543 },
  { source: "ddauto", count: 67 },
  { source: "rivervalley", count: 1553 },
  { source: "fenix", count: 4595 },
  { source: "importapart", count: 75 },
  { source: "bigtruckpage", count: 48 },
  { source: "speedys", count: 1 },
  { source: "sandw", count: 624 },
  { source: "denton", count: 2297 },
  { source: "scotts", count: 976 },
  { source: "oem", count: 2158 },
  { source: "dutchers", count: 579 },
  { source: "chasencars", count: 661 },
  { source: "weberbrothers", count: 5760 },
  { source: "oemgarage", count: 239 },
  { source: "hagerman", count: 5 },
  { source: "kandr", count: 48 },
  { source: "jimsimport", count: 3649 },
  { source: "lonestarimports", count: 2531 },
  { source: "alshned", count: 41 },
  { source: "hollanderstores", count: hollanderstoresExpected.count },
  { source: "cstruck", count: 59 },
  { source: "heavytruckparts", count: 838 },
  { source: "beavers", count: 278 },
  { source: "indianriver", count: 1049 },
  { source: "harrys", count: 4105 },
  { source: "budget", count: 1606 },
  { source: "army", count: 231 },
  { source: "idipull", count: 535 },
  { source: "bigd", count: 288 },
  { source: "pullsavewa", count: 2065 },
  { source: "littleton", count: 1079 },
  { source: "michigantruck", count: 173 },
  { source: "joliet", count: 1392 },
  { source: "alln1", count: 1093 },
  { source: "grandpajohns", count: 636 },
  { source: "pickers", count: 1928 },
  { source: "pipes", count: 535 },
  { source: "uwrench", count: 1121 },
  { source: "millerstown", count: 1087 },
  { source: "pickapartva", count: 7422 },
  { source: "mccauley", count: 24 },
  { source: "rustyhook", count: 25 },
  { source: "aviation", count: 2326 },
  { source: "chaz", count: 1063 },
  { source: "citymotors", count: 171 },
  { source: "awap", count: 183 },
  { source: "clearsalvage", count: 177 },
  { source: "aplus", count: 1222 },
  { source: "central", count: 5957 },
  { source: "coutu", count: 1254 },
  { source: "kodak", count: 38 },
  { source: "six03", count: 973 },
  { source: "rohner", count: 286 },
  { source: "pratt", count: 5931 },
  { source: "cars4parts", count: 71 },
  { source: "meeks", count: 1415 },
  { source: "brandywine", count: 1807 },
  { source: "rmmdtp", count: 103 },
  { source: "rtp", count: 3195 },
  { source: "nvpap", count: 3278 },
  { source: "pontiac", count: 1307 },
  { source: "aero", count: 130 },
  { source: "hawaiiparts", count: 44 },
  { source: "modernmuscle", count: 347 },
  { source: "allied", count: 2507 },
  { source: "byot", count: 5330 },
  { source: "vinplus", count: 7621 },
  { source: "northwest", count: 6688 },
  { source: "calton", count: 12549 },
  { source: "urgiis", count: 70704 },
] as const;

test.each([...censuses])(
  "$source permits ordinary turnover while preserving the prior-run drift guard",
  ({ source, count }) => {
    const minimum = SourceValidationPolicy.minimumUniqueInventory[source];
    expect(minimum).toBeGreaterThanOrEqual(
      Math.max(1, Math.floor(count * 0.3)),
    );
    expect(minimum).toBeLessThanOrEqual(Math.max(1, Math.ceil(count * 0.35)));
    const current = Math.max(1, Math.floor(count * 0.6));
    const input = {
      source,
      terminal: true,
      uniqueVehicles: current,
      vehiclesProcessed: current,
      duplicateVehicles: 0,
      rejectedVehicles: 0,
      errors: [],
      previousAcceptedCount: count,
    };
    expect(validateSourceSnapshot(input)).toEqual({
      status: "accepted",
      errors: [],
    });
    expect(
      validateSourceSnapshot({
        ...input,
        uniqueVehicles: minimum - 1,
        vehiclesProcessed: minimum - 1,
        previousAcceptedCount: null,
      }).status,
    ).toBe("rejected");
    if (count >= 4) {
      const result = validateSourceSnapshot({
        ...input,
        uniqueVehicles: Math.floor(count * 0.5) - 1,
        vehiclesProcessed: Math.floor(count * 0.5) - 1,
      });
      expect(result.status).toBe("rejected");
      expect(result.errors.join(" ")).toContain("50% drift limit");
    }
  },
);

test.each(hollanderstoresExpected.perYard)(
  "Hollander $code keeps a one-third accepted-census floor",
  ({ code, accepted }) => {
    const yard = HOLLANDERSTORES_YARDS.find((yard) => yard.code === code);
    if (!yard) throw new Error(`Missing Hollander yard ${code}`);
    expect<number>(yard.minimum).toBe(Math.max(1, Math.floor(accepted / 3)));
  },
);

// Established providers keep their existing floors.
const established = [
  { source: "row52", minimum: 10000 },
  { source: "pyp", minimum: 5000 },
  { source: "autorecycler", minimum: 100 },
  { source: "pullapart", minimum: 5000 },
  { source: "upullitne", minimum: 500 },
  { source: "upullitdavie", minimum: 250 },
  { source: "gopullit", minimum: 500 },
  { source: "pullnsave", minimum: 5000 },
  { source: "tearapart", minimum: 500 },
  { source: "wrenchapart", minimum: 9000 },
  { source: "upullrparts", minimum: 2000 },
  { source: "ipullupull", minimum: 3000 },
  { source: "upullitwa", minimum: 1500 },
  { source: "partsgalore", minimum: 500 },
] as const;
test.each([...established])(
  "$source retains its established inventory floor",
  ({ source, minimum }) => {
    expect(SourceValidationPolicy.minimumUniqueInventory[source]).toBe(minimum);
  },
);
