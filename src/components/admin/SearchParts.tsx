import type { SearchBacklog } from "~/server/admin/search-overview";
import type { SearchStatus } from "~/server/ingestion/search-status";

export function SearchBacklogText({ backlog }: { backlog: SearchBacklog }) {
  const count = backlog.count.toLocaleString("en-US");
  return (
    <span>
      {backlog.kind === "inline" && backlog.capped ? `${count}+` : count}
    </span>
  );
}

/** The search status in plain words. */
export function searchStatusText(status: SearchStatus): string {
  switch (status.status) {
    case "inline":
      return "Each yard's run updates search itself when it publishes.";
    case "paused":
      return "The search updater is paused by its flag; changes wait for it.";
    case "healthy":
      return "The search updater is keeping up.";
    case "unhealthy":
      return "The search updater is behind or blocked.";
  }
}
