import { type Metadata } from "next";
import { geolocation } from "@vercel/functions";
import { headers } from "next/headers";
import { userAgent } from "next/server";
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
          <YardMap
            compactMap={compactMap}
            yards={inventory.yards}
            vehicleCount={vehicleCount}
            approximateLocation={approximateLocation}
          />
        </section>
        <RecentVehicles vehicles={inventory.recentVehicles} />
        <HomeFaq />
        <HomePricing />
        <HomeClosingCta />
      </main>
      <Footer />
    </div>
  );
}
