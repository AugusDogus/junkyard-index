import type { Yard } from "~/lib/yard";
import type { UrgiisSite } from "./urgiis-schema";
export type UrgiisYard = Omit<
  Yard,
  "source" | "lat" | "lng" | "address" | "postalCode" | "websiteUrl"
> & {
  source: "urgiis";
  address: string;
  postalCode: string;
  websiteUrl: string;
  lat: number;
  lng: number;
};
/** How a tenant's requests reach its site. `native`: server fetch with the
 * tenant's headers and cookie. `browser`: a Hyperbrowser session under the
 * session lease, for sites whose CDN refuses the deployment's egress; the
 * browser owns cookies and headers. */
export type UrgiisTransport = "native" | "browser";
export interface UrgiisTenant extends UrgiisSite {
  code: string;
  transport: UrgiisTransport;
  makesPath: string;
  arrivalsPath: string | null;
  ownerPath: string;
  ownerClaims: readonly string[];
  cookie: string | null;
  userAgent?: "firefox";
  /** Qualified model requests use raw &, while donor links publish and__. */
  modelEncoding?: "literal-ampersand";
  pacingMs: number;
  requestTimeoutMs: number;
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
  /** The qualification contract that cursor and census scopes bind: every
   * field but `transport`, which changes how bytes arrive, not what is read
   * or admitted. Switching a tenant's transport keeps in-flight checkpoints
   * and accepted census history. */
  qualification(tenant: UrgiisTenant): Omit<UrgiisTenant, "transport"> {
    const { transport: _transport, ...qualification } = tenant;
    void _transport;
    return qualification;
  },
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
