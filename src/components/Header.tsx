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

      const message =
        data.aggregateStatus === "degraded"
          ? "Some yard data may be incomplete."
          : "Some yard data is temporarily unavailable.";

      return {
        aggregateStatus: data.aggregateStatus,
        message,
        affected: affected.join(", "),
        statusPageUrl: data.statusPageUrl,
      };
    }),
  ]);

  return (
    <HeaderContent user={session?.user ?? null} statusData={statusData} />
  );
}
