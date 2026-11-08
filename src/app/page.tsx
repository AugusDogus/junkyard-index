import {
  HOME_METADATA,
  HomeLandingPage,
} from "~/components/home/HomeLandingPage";

export const metadata = HOME_METADATA;

// Signed-in visitors are sent to /search by src/proxy.ts, which checks only
// for the session cookie, so rendering this page never reads the session.
export default HomeLandingPage;
