import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  HOME_METADATA,
  HomeLandingPage,
} from "~/components/home/HomeLandingPage";
import { auth } from "~/lib/auth";

export const metadata = HOME_METADATA;

export default async function HomeEntry() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (session?.user) {
    redirect("/search");
  }

  return <HomeLandingPage />;
}
