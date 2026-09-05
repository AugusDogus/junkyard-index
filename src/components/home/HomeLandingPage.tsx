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
import { hasFiniteCoordinates } from "~/lib/location-preferences";

export const HOME_METADATA: Metadata = {
  title: "Search Salvage Yard Inventory Nationwide",
  description:
    "Search salvage yard inventory across LKQ, Row52, Pull-A-Part, and more. Explore junkyard locations, find donor vehicles for parts, and get alerts when new matches arrive.",
  alternates: { canonical: "/" },
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
        <h1 className="sr-only">Junkyard Index</h1>
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
