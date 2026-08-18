import { headers } from "next/headers";
import { auth } from "~/lib/auth";
import { api } from "~/trpc/server";
import { HeaderContent } from "./HeaderContent";
import type { HeaderStatusData } from "./HeaderStatusIndicator";

export async function Header() {
  const [session, statusData] = await Promise.all([
    auth.api.getSession({ headers: await headers() }),
    api.status.providers().then((data): HeaderStatusData | null => {
      if (data.aggregateStatus === "operational") return null;

      const affected = data.providers
        .filter((p) => p.status !== "operational")
        .map((p) => p.name);

      return {
        aggregateStatus: data.aggregateStatus,
        affected: affected.join(", "),
        statusPageUrl: data.statusPageUrl,
      };
    }),
  ]);

  return (
    <HeaderContent user={session?.user ?? null} statusData={statusData} />
  );
}
