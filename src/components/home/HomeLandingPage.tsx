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
          className="shell pt-6 pb-12 sm:pt-8"
          aria-labelledby="home-title"
        >
          <div className="pb-5">
            <h1
              id="home-title"
              className="text-[clamp(1.75rem,1.6vw+1rem,2.5rem)] leading-[1.04] font-extrabold"
            >
              Search {inventory.yards.length.toLocaleString("en-US")} salvage
              yards at once
            </h1>
            <p className="text-ink-2 text-lead mt-2">
              Year, make, model, or VIN across every yard on this map.
            </p>
          </div>
          <HomeSearchHero />
          <div className="mt-4">
            <Suspense
              fallback={
                <div aria-hidden="true" className="border-ink border-2">
                  <div className="bg-board h-16" />
                  <div className="homepage-map-layout bg-paper-2 border-ink border-t-2">
                    <div className="homepage-map-canvas" />
                    <div className="bg-paper-3 border-ink h-[54px] border-t-2 lg:hidden" />
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
            <p className="text-ink-2 mt-3 text-sm text-pretty">
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
                  ? "bg-board border-ink h-[31rem] border-y-2"
                  : "bg-board border-ink h-56 border-y-2"
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
