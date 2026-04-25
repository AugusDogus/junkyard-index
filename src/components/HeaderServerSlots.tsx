import { headers } from "next/headers";
import { auth } from "~/lib/auth";
import { getProviderStatus } from "~/server/api/routers/status";
import { HeaderAuthButtons } from "./HeaderAuthButtons";
import {
  HeaderStatusIndicator,
  type HeaderStatusData,
} from "./HeaderStatusIndicator";

function toHeaderStatusData(
  data: Awaited<ReturnType<typeof getProviderStatus>>,
): HeaderStatusData | null {
  if (data.aggregateStatus === "operational") {
    return null;
  }

  const affected = data.providers
    .filter((provider) => provider.status !== "operational")
    .map((provider) => provider.name);

  const message =
    data.aggregateStatus === "in_progress"
      ? "Ingestion is currently running."
      : data.aggregateStatus === "degraded"
        ? "Some yard data may be incomplete."
        : "Some yard data is temporarily unavailable.";

  return {
    aggregateStatus: data.aggregateStatus,
    message,
    affected: affected.join(", "),
    statusPageUrl: data.statusPageUrl,
  };
}

export async function HeaderAuthSlot() {
  const session = await auth.api.getSession({ headers: await headers() });

  return <HeaderAuthButtons user={session?.user ?? null} />;
}

export async function HeaderStatusSlot() {
  const statusData = toHeaderStatusData(await getProviderStatus());

  if (!statusData) {
    return null;
  }

  return (
    <>
      <HeaderStatusIndicator data={statusData} />
      <div className="bg-border h-5 w-px" aria-hidden="true" />
    </>
  );
}
