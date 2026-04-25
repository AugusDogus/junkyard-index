import { getLiveHomepageStats } from "~/lib/homepage-stats";

const numberFormatter = new Intl.NumberFormat("en-US");

interface HomeLiveStatsProps {
  variant: "mobile" | "desktop";
}

function formatVehicleCount(count: number): string {
  return numberFormatter.format(count);
}

function formatYardCount(count: number): string {
  return numberFormatter.format(count);
}

export async function HomeLiveStats({ variant }: HomeLiveStatsProps) {
  const liveStats = await getLiveHomepageStats();

  if (variant === "mobile") {
    return (
      <div className="text-muted-foreground mt-5 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums sm:hidden">
        <p>
          <span className="text-foreground font-medium">
            {formatVehicleCount(liveStats.vehicleCount)}
          </span>{" "}
          vehicles
        </p>
        <p>
          <span className="text-foreground font-medium">
            {formatYardCount(liveStats.yardCount)}
          </span>{" "}
          yards
        </p>
        <p>Free to search</p>
      </div>
    );
  }

  return (
    <div className="hidden gap-4 sm:grid sm:grid-cols-2 lg:grid-cols-1">
      <ProofCard
        title={`${formatVehicleCount(liveStats.vehicleCount)} vehicles tracked`}
        description="Inventory from multiple salvage networks, updated into one searchable index."
      />
      <ProofCard
        title={`${formatYardCount(liveStats.yardCount)} yards nationwide`}
        description="Find donor vehicles near you or widen the search when the local yards come up empty."
      />
      <ProofCard
        title="Free search, paid tracking"
        description="Search anonymously, create a free account to save work, and use Alerts Plan when timing matters."
      />
    </div>
  );
}

export function HomeLiveStatsSkeleton({ variant }: HomeLiveStatsProps) {
  if (variant === "mobile") {
    return (
      <div className="text-muted-foreground mt-5 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums sm:hidden">
        <p>
          <span className="text-foreground font-medium">Loading</span> vehicles
        </p>
        <p>
          <span className="text-foreground font-medium">Loading</span> yards
        </p>
        <p>Free to search</p>
      </div>
    );
  }

  return (
    <div className="hidden gap-4 sm:grid sm:grid-cols-2 lg:grid-cols-1">
      <ProofCard
        title="Loading inventory stats"
        description="We are fetching current inventory counts from the index."
      />
      <ProofCard
        title="Loading yard coverage"
        description="We are fetching the current yard footprint for the network."
      />
      <ProofCard
        title="Free search, paid tracking"
        description="Search anonymously, create a free account to save work, and use Alerts Plan when timing matters."
      />
    </div>
  );
}

function ProofCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border p-5">
      <p className="text-lg font-semibold tracking-tight tabular-nums">
        {title}
      </p>
      <p className="text-muted-foreground mt-1.5 text-sm text-pretty">
        {description}
      </p>
    </div>
  );
}
