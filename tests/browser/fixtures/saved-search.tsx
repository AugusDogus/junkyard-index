import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { SaveSearchDialog } from "~/components/search/SaveSearchDialog";
import { SearchStartPanel } from "~/components/search/SearchStartPanel";
import { SavedSearchesList } from "~/components/search/SavedSearchesList";
import { SavedSearchSettingsCard } from "~/components/settings/SavedSearchSettingsCard";
import { SettingsNav } from "~/components/settings/SettingsNav";
import { SettingsPageHeader } from "~/components/settings/SettingsPageHeader";
import { api, type RouterOutputs } from "~/trpc/react";

const parameters = new URLSearchParams(window.location.search);
const search: RouterOutputs["savedSearches"]["list"][number] = {
  id: "saved-volvo",
  userId: "test-user",
  name: "Future donor",
  query: parameters.get("query") ?? 'wagon (Volvo OR Saab) "roof rack" !diesel',
  filters: {
    makes: ["Saab"],
    minYear: 1980,
    maxYear: 2000,
    ...(parameters.has("vin") ? { vinPattern: "YV4C*85**********" } : {}),
  },
  emailAlertsEnabled: true,
  discordAlertsEnabled: false,
  searchMatchVersion: 1,
  emailConfigVersion: 1,
  discordConfigVersion: 1,
  emailStartSequence: 0,
  discordStartSequence: 0,
  lastMatchedPublicationSequence: 0,
  lastCheckedAt: null,
  alertQuarantinedAt: null,
  alertQuarantineReason: null,
  processingLock: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function Fixture() {
  const [submission, setSubmission] = useState<unknown>(null);
  const failNext = useRef(parameters.has("fail"));
  const currentSearches = useRef([
    search,
    ...(parameters.has("multiple")
      ? [
          {
            ...search,
            id: "saved-truck",
            name: "Tacoma donor with a particularly long saved search name",
            query: "Toyota Tacoma",
            filters: { minYear: 2016, colors: ["White"] },
            emailAlertsEnabled: false,
            discordAlertsEnabled: true,
          },
        ]
      : []),
  ]);
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    if (!parameters.has("no-suggestions"))
      client.setQueryData(["inventory-filter-options"], {
        makes: ["Volvo", "Ford"],
        colors: ["Red"],
        states: ["Texas"],
        salvageYards: ["Omaha"],
      });
    return client;
  });
  const [client] = useState(() =>
    api.createClient({
      links: [
        () =>
          ({ op }) =>
            observable((observer) => {
              if (op.type === "mutation") {
                if (failNext.current) {
                  failNext.current = false;
                  observer.error(
                    new TRPCClientError("The save failed. Try again."),
                  );
                  return;
                }
                const input = op.input;
                if (
                  typeof input === "object" &&
                  input !== null &&
                  "id" in input
                ) {
                  if (op.path === "savedSearches.delete") {
                    currentSearches.current = currentSearches.current.filter(
                      (item) => item.id !== input.id,
                    );
                  }
                  if (
                    "enabled" in input &&
                    typeof input.enabled === "boolean"
                  ) {
                    const enabled = input.enabled;
                    currentSearches.current = currentSearches.current.map(
                      (item) => {
                        if (item.id !== input.id) return item;
                        if (op.path === "savedSearches.toggleEmailAlerts")
                          return { ...item, emailAlertsEnabled: enabled };
                        if (op.path === "savedSearches.toggleDiscordAlerts")
                          return { ...item, discordAlertsEnabled: enabled };
                        return item;
                      },
                    );
                  }
                }
                setSubmission({ path: op.path, input: op.input });
              }
              const data =
                op.path === "savedSearches.list"
                  ? currentSearches.current
                  : op.path === "subscription.getAccountOverview"
                    ? { kind: "active", tier: "full" }
                    : op.path === "user.getNotificationSettings"
                      ? {
                          hasDiscordLinked: parameters.has("discord"),
                          discordAppInstalled: parameters.has("discord"),
                        }
                      : { id: search.id };
              observer.next({ result: { data } });
              observer.complete();
            }),
      ],
    }),
  );
  const noOp = () => undefined;
  return (
    <AppRouterContext.Provider
      value={{
        back: noOp,
        forward: noOp,
        refresh: noOp,
        push: noOp,
        replace: noOp,
        prefetch: noOp,
      }}
    >
      <PathnameContext.Provider value="/settings/searches">
        <QueryClientProvider client={queryClient}>
          <api.Provider client={client} queryClient={queryClient}>
            <main className="mx-auto flex max-w-6xl flex-col gap-8 p-5 sm:p-8">
              {parameters.has("settings") ? (
                <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
                  <SettingsNav />
                  <div className="flex min-w-0 flex-col gap-8">
                    <SettingsPageHeader
                      title="Searches"
                      description="Keep track of the vehicles you’re looking for, including those that haven’t arrived yet."
                    />
                    <SavedSearchSettingsCard />
                  </div>
                </div>
              ) : parameters.has("scene") ? (
                <SearchStartPanel
                  isLoggedIn
                  savedSearchesLocked={false}
                  vinPatternSearchReady
                  onSearch={noOp}
                />
              ) : (
                <SavedSearchesList locked={false} />
              )}
              <SaveSearchDialog
                query=""
                filters={{ makes: ["Saab"] }}
                planAccess={{ kind: "resolved", tier: "full" }}
                isLoggedIn
              />
              <output
                id="submission"
                className="block max-w-full break-all whitespace-pre-wrap"
              >
                {JSON.stringify(submission)}
              </output>
            </main>
          </api.Provider>
        </QueryClientProvider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>
  );
}

createRoot(document.body).render(<Fixture />);
