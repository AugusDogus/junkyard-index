import {
  generateHomeMetadata,
  HomeLandingPage,
} from "~/components/home/HomeLandingPage";

export const generateMetadata = generateHomeMetadata;

// Served from the CDN and rebuilt after each daily ingestion pass, which
// invalidates the inventory cache tag. This is the fallback lifetime.
export const revalidate = 86400;

// Signed-in visitors are sent to /search by src/proxy.ts, which checks only
// for the session cookie, so rendering this page never reads the request.
export default HomeLandingPage;
