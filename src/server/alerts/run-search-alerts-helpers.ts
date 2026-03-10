import { z } from "zod";
import { filtersSchema } from "~/lib/saved-search-filters";

export type SavedSearchFiltersParseResult =
  | {
      success: true;
      data: z.infer<typeof filtersSchema>;
    }
  | {
      success: false;
      reason: "malformed_json";
      error: SyntaxError;
    }
  | {
      success: false;
      reason: "invalid_schema";
      error: z.ZodError<z.infer<typeof filtersSchema>>;
    };

export function parseSavedSearchFilters(
  rawFiltersJson: string,
): SavedSearchFiltersParseResult {
  let rawFilters: unknown;
  try {
    rawFilters = JSON.parse(rawFiltersJson);
  } catch (error) {
    return {
      success: false,
      reason: "malformed_json",
      error:
        error instanceof SyntaxError
          ? error
          : new SyntaxError(String(error)),
    };
  }

  const filtersParseResult = filtersSchema.safeParse(rawFilters);
  if (filtersParseResult.success) {
    return filtersParseResult;
  }

  return {
    success: false,
    reason: "invalid_schema",
    error: filtersParseResult.error,
  };
}

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
