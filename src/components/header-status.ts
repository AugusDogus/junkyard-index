export type HeaderStatus = "in_progress" | "degraded" | "down";

export interface HeaderStatusPresentation {
  title: string;
  ariaLabel: string;
  message: string;
  colorClass: string;
  icon: "info" | "warning";
}

const HEADER_STATUS_PRESENTATION: Record<
  HeaderStatus,
  HeaderStatusPresentation
> = {
  in_progress: {
    title: "Ingestion In Progress",
    ariaLabel: "Ingestion currently in progress",
    message: "Ingestion is currently running.",
    colorClass: "text-sky-500 dark:text-sky-400",
    icon: "info",
  },
  degraded: {
    title: "Inventory Refresh Degraded",
    ariaLabel: "Inventory refresh degraded",
    message:
      "Some provider inventory was only partially refreshed during the latest ingestion run. Provider websites may still be available.",
    colorClass: "text-amber-500 dark:text-amber-400",
    icon: "info",
  },
  down: {
    title: "Inventory Refresh Failed",
    ariaLabel: "Inventory refresh failed",
    message:
      "Some provider inventory was not refreshed during the latest ingestion run. Provider websites may still be available.",
    colorClass: "text-red-500 dark:text-red-400",
    icon: "warning",
  },
};

export function getHeaderStatusPresentation(
  status: HeaderStatus,
): HeaderStatusPresentation {
  return HEADER_STATUS_PRESENTATION[status];
}
