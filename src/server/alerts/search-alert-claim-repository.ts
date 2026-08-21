import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { savedSearch } from "~/schema";

export interface SearchWithAlerts {
  id: string;
  userId: string;
  name: string;
  query: string;
  filters: string;
  lastCheckedAt: Date | null;
  emailAlertsEnabled: boolean;
  discordAlertsEnabled: boolean;
}

export interface UserSearchClaim {
  searches: [SearchWithAlerts, ...SearchWithAlerts[]];
  lockTime: Date;
}

function claimedEntireSearchGroup(
  selectedSearches: Array<{ id: string }>,
  claimedSearches: Array<{ id: string }>,
): boolean {
  if (selectedSearches.length !== claimedSearches.length) return false;
  const selectedIds = new Set(selectedSearches.map(({ id }) => id));
  const claimedIds = new Set(claimedSearches.map(({ id }) => id));
  return (
    selectedIds.size === claimedIds.size &&
    [...selectedIds].every((id) => claimedIds.has(id))
  );
}

export function createSearchAlertClaimRepository(database: LibSQLDatabase) {
  return {
    async claimUserSearches(
      userId: string,
      staleLockThreshold: Date,
    ): Promise<UserSearchClaim | null> {
      return database.transaction(async (tx) => {
        const currentSearches = await tx
          .select({
            id: savedSearch.id,
            userId: savedSearch.userId,
            name: savedSearch.name,
            query: savedSearch.query,
            filters: savedSearch.filters,
            lastCheckedAt: savedSearch.lastCheckedAt,
            emailAlertsEnabled: savedSearch.emailAlertsEnabled,
            discordAlertsEnabled: savedSearch.discordAlertsEnabled,
          })
          .from(savedSearch)
          .where(
            and(
              eq(savedSearch.userId, userId),
              or(
                eq(savedSearch.emailAlertsEnabled, true),
                eq(savedSearch.discordAlertsEnabled, true),
              ),
            ),
          );

        const [firstSearch, ...remainingSearches] = currentSearches;
        if (!firstSearch) return null;
        const searches: [SearchWithAlerts, ...SearchWithAlerts[]] = [
          firstSearch,
          ...remainingSearches,
        ];
        const lockTime = new Date();
        const claimedSearches = await tx
          .update(savedSearch)
          .set({ processingLock: lockTime })
          .where(
            and(
              eq(savedSearch.userId, userId),
              or(
                eq(savedSearch.emailAlertsEnabled, true),
                eq(savedSearch.discordAlertsEnabled, true),
              ),
              or(
                isNull(savedSearch.processingLock),
                lt(savedSearch.processingLock, staleLockThreshold),
              ),
            ),
          )
          .returning({ id: savedSearch.id });

        if (!claimedEntireSearchGroup(searches, claimedSearches)) {
          if (claimedSearches.length > 0) {
            await tx
              .update(savedSearch)
              .set({ processingLock: null })
              .where(
                and(
                  eq(savedSearch.userId, userId),
                  eq(savedSearch.processingLock, lockTime),
                ),
              );
          }
          return null;
        }

        return { searches, lockTime };
      });
    },

    async releaseUserSearchClaim(
      userId: string,
      lockTime: Date,
    ): Promise<void> {
      await database
        .update(savedSearch)
        .set({ processingLock: null })
        .where(
          and(
            eq(savedSearch.userId, userId),
            eq(savedSearch.processingLock, lockTime),
          ),
        );
    },
  };
}
