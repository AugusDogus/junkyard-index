import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { SaveSearchDialog } from "~/components/search/SaveSearchDialog";
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
  const currentSearch = useRef(search);
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
                  "enabled" in input &&
                  typeof input.enabled === "boolean"
                ) {
                  if (op.path === "savedSearches.toggleEmailAlerts")
                    currentSearch.current = {
                      ...currentSearch.current,
                      emailAlertsEnabled: input.enabled,
                    };
                  if (op.path === "savedSearches.toggleDiscordAlerts")
                    currentSearch.current = {
                      ...currentSearch.current,
                      discordAlertsEnabled: input.enabled,
                    };
                }
                setSubmission({ path: op.path, input: op.input });
              }
              const data =
                op.path === "savedSearches.list"
                  ? [currentSearch.current]
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
