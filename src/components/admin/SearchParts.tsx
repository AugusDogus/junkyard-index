import type { SearchBacklog } from "~/server/admin/search-overview";
import type { SearchPublication } from "~/server/admin/search-repository";
import type { SearchStatus } from "~/server/ingestion/search-status";

/**
 * A search publication's result in plain words. A degraded run of one source
 * means that source was rejected and its previous vehicles kept; only the
 * older runs of every source at once ("all") published while leaving some
 * sources out.
 */
export function publicationResultText(
  publication: Pick<SearchPublication, "source" | "inventoryOutcome">,
): string {
  switch (publication.inventoryOutcome) {
    case "published":
      return "Published";
    case "published_degraded":
      return publication.source === "all"
        ? "Some sources left out"
        : "Rejected, previous vehicles kept";
    case null:
      return "Unknown";
    default:
      return publication.inventoryOutcome;
  }
}

/** A daily alert check's status in plain words. */
export function alertCheckStatusText(status: string): string {
  switch (status) {
    case "complete":
      return "Finished";
    case "running":
      return "Running";
    case "superseded":
      return "Replaced by a later check";
    default:
      return status;
  }
}

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
