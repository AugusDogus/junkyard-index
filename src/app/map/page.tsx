import { Footer } from "~/components/Footer";
import { PublicHeader } from "~/components/PublicHeader";
import {
  loadYardMapSection,
  YardMapSection,
} from "~/components/home/YardMapSection";
import { mapMetadata } from "./map-metadata";

export const metadata = mapMetadata;

// Served from the CDN and rebuilt after each daily ingestion pass, which
// invalidates the inventory cache tag. This is the fallback lifetime.
export const revalidate = 86400;

// src/proxy.ts sends signed-in visitors from "/" to /search; this page is
// where they reach the yard map.
export default async function MapPage() {
  const { inventory, section } = await loadYardMapSection();
  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="shell pt-6 pb-12 sm:pt-8">
        <div className="pb-5">
          <h1 className="text-[clamp(1.75rem,1.6vw+1rem,2.5rem)] leading-[1.04] font-extrabold">
            Salvage yard map
          </h1>
          <p className="text-ink-2 text-lead mt-2">
            {inventory.yards.length.toLocaleString("en-US")} yards. Pick one for
            its inventory, website and directions.
          </p>
        </div>
        <YardMapSection {...section} layout="page" />
      </main>
      <Footer status="link" />
    </div>
  );
}
