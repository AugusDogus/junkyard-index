import {
  generateHomeMetadata,
  HomeLandingPage,
} from "~/components/home/HomeLandingPage";

export const generateMetadata = generateHomeMetadata;

// Signed-in visitors are sent to /search by src/proxy.ts, which checks only
// for the session cookie, so rendering this page never reads the session.
export default HomeLandingPage;
