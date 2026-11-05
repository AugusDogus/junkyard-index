import { type Metadata } from "next";
import { geolocation } from "@vercel/functions";
import { headers } from "next/headers";
import { userAgent } from "next/server";
import { Suspense } from "react";
import { Footer } from "~/components/Footer";
import { Header } from "~/components/Header";
import { HomeSearchHero } from "~/components/home/HomeSearchHero";
import { RecentVehicles } from "~/components/home/RecentVehicles";
import { YardMap } from "~/components/home/YardMap";
import { HomePricing } from "~/components/home/HomePricing";
import { HomeFaq } from "~/components/home/HomeFaq";
import { HomeClosingCta } from "~/components/home/HomeClosingCta";
import { getHomepageInventory } from "~/lib/homepage-inventory";
import { JsonLd } from "~/components/JsonLd";
import { env } from "~/env";
import { hasFiniteCoordinates } from "~/lib/location-preferences";
import { SITE_OPEN_GRAPH } from "~/lib/site-metadata";

const HOME_TITLE = "Search Junkyard Inventory at 200+ Salvage Yards";
const HOME_DESCRIPTION =
  "Search live inventory at 200+ salvage yards, including LKQ Pick Your Part, Pick-n-Pull, and Pull-A-Part. Updated daily, with alerts when a match arrives.";

export const HOME_METADATA: Metadata = {
  title: { absolute: `${HOME_TITLE} | Junkyard Index` },
  description: HOME_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    ...SITE_OPEN_GRAPH,
    type: "website",
    url: "/",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
  },
};

export async function HomeLandingPage() {
  const requestHeaders = await headers();
  const geo = geolocation({ headers: requestHeaders });
  const compactMap =
    userAgent({ headers: requestHeaders }).device.type === "mobile";
  const coordinates = {
    lat: geo.latitude ? Number(geo.latitude) : null,
    lng: geo.longitude ? Number(geo.longitude) : null,
  };
  const approximateLocation = hasFiniteCoordinates(coordinates)
    ? coordinates
    : null;
  const inventory = await getHomepageInventory();
  const vehicleCount = inventory.yards.reduce(
    (total, yard) => total + yard.vehicleCount,
    0,
  );

  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <Header />
      <main className="flex-1">
        <h1 className="sr-only">
          Junkyard Index: search salvage yard inventory
        </h1>
        <JsonLd
          nodes={[
            {
              "@type": "Organization",
              "@id": `${env.NEXT_PUBLIC_APP_URL}/#organization`,
              name: "Junkyard Index",
              url: env.NEXT_PUBLIC_APP_URL,
              logo: `${env.NEXT_PUBLIC_APP_URL}/favicon.svg`,
              sameAs: ["https://github.com/AugusDogus/junkyard-index"],
            },
            {
              "@type": "WebSite",
              "@id": `${env.NEXT_PUBLIC_APP_URL}/#website`,
              name: "Junkyard Index",
              url: env.NEXT_PUBLIC_APP_URL,
              publisher: { "@id": `${env.NEXT_PUBLIC_APP_URL}/#organization` },
              potentialAction: {
                "@type": "SearchAction",
                target: {
                  "@type": "EntryPoint",
                  urlTemplate: `${env.NEXT_PUBLIC_APP_URL}/search?q={search_term_string}`,
                },
                "query-input": "required name=search_term_string",
              },
            },
          ]}
        />
        <section
          className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8"
          aria-label="Search junkyard inventory"
        >
          <HomeSearchHero />
          <div className="pb-3">
            <Suspense
              fallback={
                <div aria-hidden="true">
                  <div className="bg-card h-[45px] rounded-t-lg border border-b-0" />
                  <div className="homepage-map-layout bg-muted overflow-hidden rounded-b-lg border">
                    <div className="homepage-map-canvas" />
                    <div className="bg-card h-[57px] border-t lg:hidden" />
                  </div>
                </div>
              }
            >
              <YardMap
                compactMap={compactMap}
                yards={inventory.yards}
                vehicleCount={vehicleCount}
                approximateLocation={approximateLocation}
              />
            </Suspense>
            <p className="text-muted-foreground mt-2 text-xs text-pretty">
              Confirm vehicle availability with the yard before visiting.
            </p>
          </div>
        </section>
        <Suspense
          fallback={
            <div
              aria-hidden="true"
              className={
                inventory.recentVehicles.length
                  ? "h-[156px] border-y"
                  : "h-[90px] border-y"
              }
            />
          }
        >
          <RecentVehicles vehicles={inventory.recentVehicles} />
        </Suspense>
        <HomeFaq />
        <HomePricing />
        <HomeClosingCta />
      </main>
      <Footer />
    </div>
  );
}
