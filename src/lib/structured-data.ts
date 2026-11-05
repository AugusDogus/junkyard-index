import type { YardVehicle } from "./yard-inventory";

/** A schema.org node, as emitted in JSON-LD. */
export type JsonLdNode = { "@type": string } & Record<string, unknown>;

export type Crumb = { name: string; href: string };

type YardBusiness = {
  name: string;
  operator: string | null;
  address: string | null;
  city: string;
  state: string;
  postalCode: string | null;
  country: "US" | "CA";
  lat: number;
  lng: number;
  phone: string | null;
  website: { kind: "yard" | "provider"; href: string } | null;
};

function absolute(origin: string, href: string): string {
  return new URL(href, origin).toString();
}

export const StructuredData = {
  /** One JSON-LD document holding every node on the page. */
  graph(nodes: readonly JsonLdNode[]) {
    return { "@context": "https://schema.org", "@graph": nodes };
  },

  /**
   * Serializes JSON-LD for a `<script>` body. `<` is escaped so stored text
   * such as a yard name can't close the script element.
   */
  serialize(document: unknown): string {
    return JSON.stringify(document).replace(/</g, "\\u003c");
  },

  breadcrumbs(origin: string, crumbs: readonly Crumb[]): JsonLdNode {
    return {
      "@type": "BreadcrumbList",
      itemListElement: crumbs.map((crumb, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: crumb.name,
        item: absolute(origin, crumb.href),
      })),
    };
  },

  /**
   * The yard as a local business. `url` is its own site only when we know a
   * yard-specific one; this page is the business's `mainEntityOfPage`.
   */
  yard(origin: string, pageHref: string, yard: YardBusiness): JsonLdNode {
    const pageUrl = absolute(origin, pageHref);
    return {
      "@type": "AutoPartsStore",
      "@id": `${pageUrl}#yard`,
      name: yard.name,
      mainEntityOfPage: pageUrl,
      ...(yard.website?.kind === "yard" && { url: yard.website.href }),
      ...(yard.operator && {
        parentOrganization: { "@type": "Organization", name: yard.operator },
      }),
      ...(yard.phone && { telephone: yard.phone }),
      address: {
        "@type": "PostalAddress",
        ...(yard.address && { streetAddress: yard.address }),
        addressLocality: yard.city,
        addressRegion: yard.state,
        ...(yard.postalCode && { postalCode: yard.postalCode }),
        addressCountry: yard.country,
      },
      geo: {
        "@type": "GeoCoordinates",
        latitude: yard.lat,
        longitude: yard.lng,
      },
    };
  },

  /** The vehicles shown on this page, out of `total` in the yard. */
  vehicles(
    name: string,
    total: number,
    firstIndex: number,
    vehicles: readonly YardVehicle[],
  ): JsonLdNode {
    return {
      "@type": "ItemList",
      name,
      numberOfItems: total,
      itemListOrder: "https://schema.org/ItemListOrderDescending",
      itemListElement: vehicles.map((vehicle, index) => ({
        "@type": "ListItem",
        position: firstIndex + index + 1,
        item: {
          "@type": "Car",
          name: [vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
            .filter(Boolean)
            .join(" "),
          vehicleIdentificationNumber: vehicle.vin,
          vehicleModelDate: String(vehicle.year),
          brand: { "@type": "Brand", name: vehicle.make },
          model: vehicle.model,
          ...(vehicle.color && { color: vehicle.color }),
          ...(vehicle.engine && {
            vehicleEngine: {
              "@type": "EngineSpecification",
              name: vehicle.engine,
            },
          }),
        },
      })),
    };
  },
} as const;
