import type { Yard } from "~/lib/yard";
import type { UrgiisSite } from "./urgiis-schema";
export type UrgiisYard = Omit<Yard, "source" | "lat" | "lng"> & {
  source: "urgiis";
  lat: number;
  lng: number;
};
export interface UrgiisTenant extends UrgiisSite {
  code: string;
  makesPath: string;
  ownerPath: string;
  ownerClaims: readonly string[];
  cookie: string | null;
  pacingMs: number;
  minimumInventory: number;
  photoCodes: readonly string[];
  skipBlankVin: boolean;
  placeholderStocks: readonly string[];
  yard: UrgiisYard;
  attribution:
    | { kind: "site" }
    | { kind: "photo" }
    | {
        kind: "seller";
        additionalYards: readonly UrgiisYard[];
        sellerYards: Readonly<Record<string, string>>;
        minimumByYard: Readonly<Record<string, number>>;
      };
}
export const UrgiisTenant = {
  yards(tenant: UrgiisTenant): readonly UrgiisYard[] {
    return tenant.attribution.kind !== "seller"
      ? [tenant.yard]
      : [tenant.yard, ...tenant.attribution.additionalYards];
  },
  yardForSeller(
    tenant: UrgiisTenant,
    seller: string | null,
  ): UrgiisYard | null {
    if (tenant.attribution.kind !== "seller") return tenant.yard;
    const code =
      seller === null ? undefined : tenant.attribution.sellerYards[seller];
    return UrgiisTenant.yards(tenant).find((y) => y.code === code) ?? null;
  },
} as const;
