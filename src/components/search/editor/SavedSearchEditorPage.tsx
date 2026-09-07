"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "~/trpc/react";
import { usePlanAccess } from "~/hooks/use-plan-access";
import { resolveClientPlanFeatureAccess } from "~/lib/client-plan-feature-access";
import { SavedSearchWorkspace } from "./SavedSearchWorkspace";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
export function SavedSearchEditorPage({ id }: { id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const source =
    params.get("from") === "search" ? "saved_searches_list" : "settings";
  const searches = api.savedSearches.list.useQuery();
  const planAccess = usePlanAccess(true);
  const locked = !resolveClientPlanFeatureAccess({
    access: planAccess,
    feature: "saved_searches",
  });
  const close = () =>
    router.push(source === "settings" ? "/settings/searches" : "/search");
  if (searches.isPending)
    return (
      <div aria-label="Loading saved search" aria-busy="true">
        <Skeleton className="h-10 w-60" />
        <Skeleton className="mt-8 h-80 w-full" />
      </div>
    );
  if (searches.isError)
    return (
      <div role="alert">
        <p>Saved searches could not load. Try again to open the editor.</p>
        <Button onClick={() => void searches.refetch()}>Retry</Button>
      </div>
    );
  const search = searches.data.find((item) => item.id === id);
  if (!search)
    return (
      <div>
        <h1>Saved search not found</h1>
        <p>It may have been deleted or belong to another account.</p>
        <Button onClick={close}>Saved searches</Button>
      </div>
    );
  return (
    <SavedSearchWorkspace
      key={id}
      search={search}
      source={source}
      locked={locked}
      onClose={close}
      focusAlerts={params.get("focus") === "alerts"}
    />
  );
}
