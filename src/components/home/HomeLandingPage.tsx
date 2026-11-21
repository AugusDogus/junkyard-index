import { Suspense } from "react";
import { Footer } from "~/components/Footer";
import { Header } from "~/components/Header";
import { HomeSearchHero } from "~/components/home/HomeSearchHero";
import { RecentVehicles } from "~/components/home/RecentVehicles";
import {
  loadYardMapSection,
  YardMapSection,
} from "~/components/home/YardMapSection";
import { HomePricing } from "~/components/home/HomePricing";
import { HomeFaq } from "~/components/home/HomeFaq";
import { HomeClosingCta } from "~/components/home/HomeClosingCta";
import { getHomepageInventory } from "~/lib/homepage-inventory";
import { JsonLd } from "~/components/JsonLd";
import { env } from "~/env";
import { homeMetadata } from "./home-metadata";

export async function generateHomeMetadata() {
  const inventory = await getHomepageInventory();
  return homeMetadata(inventory.yards.length);
}

export async function HomeLandingPage() {
  const { inventory, section } = await loadYardMapSection();

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
            <YardMapSection {...section} />
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
