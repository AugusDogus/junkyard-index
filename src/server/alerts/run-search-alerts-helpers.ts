export {
  parseSavedSearchFilters,
  type SavedSearchFiltersParseResult,
} from "~/lib/saved-search-filters";

export function buildAlertResultStatus(params: {
  emailSent: boolean;
  discordSent: boolean;
  errors: string[];
  canAdvanceLastCheckedAt: boolean;
}): string {
  const statusParts: string[] = [];
  if (params.errors.length > 0) {
    statusParts.push(`error: ${params.errors.join("; ")}`);
  }
  if (params.emailSent) statusParts.push("email_sent");
  if (params.discordSent) statusParts.push("discord_sent");
  if (statusParts.length === 0) statusParts.push("no_notifications_sent");
  if (!params.canAdvanceLastCheckedAt) {
    statusParts.push("last_checked_not_advanced");
  } else if (params.errors.length > 0) {
    statusParts.push("last_checked_not_advanced_due_delivery_errors");
  }

  return statusParts.join(", ");
}
