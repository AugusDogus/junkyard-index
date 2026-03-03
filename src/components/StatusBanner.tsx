import { AlertTriangle, Info } from "lucide-react";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/server";
import { StatusBannerDismissButton } from "./StatusBannerDismissButton";

const DISMISS_KEY_PREFIX = "status-banner-dismissed:";

export async function StatusBanner() {
  const data = await api.status.providers();

  if (data.aggregateStatus === "operational") {
    return null;
  }

  const affectedProviders = data.providers.filter(
    (p) => p.status !== "operational",
  );
  const affectedNames = affectedProviders.map((p) => p.name).join(", ");
  const latestRunAt = affectedProviders
    .map((p) => p.lastRunAt)
    .filter(Boolean)
    .sort()
    .pop();

  const isDegraded = data.aggregateStatus === "degraded";
  const dismissKey = `${DISMISS_KEY_PREFIX}${data.aggregateStatus}:${affectedNames}`;
  const bannerId = "status-banner";

  const initScript = `(function(){try{if(sessionStorage.getItem(${JSON.stringify(dismissKey)})==="1")return;var b=document.getElementById(${JSON.stringify(bannerId)});if(b)b.removeAttribute("hidden")}catch(e){}})()`;

  return (
    <>
      <div
        id={bannerId}
        role="status"
        aria-live="polite"
        hidden
        suppressHydrationWarning
        data-dismiss-key={dismissKey}
        className={cn(
          "relative flex items-center justify-center gap-2 px-4 py-2.5 text-center text-sm",
          isDegraded
            ? "bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
            : "bg-red-50 text-red-900 dark:bg-red-950/50 dark:text-red-200",
        )}
      >
        {isDegraded ? (
          <Info className="size-4 shrink-0" />
        ) : (
          <AlertTriangle className="size-4 shrink-0" />
        )}

        <p>
          {isDegraded
            ? "Some yard data may be incomplete right now."
            : "Some yard data is temporarily unavailable."}
          {affectedNames && (
            <span className="ml-1 opacity-75">
              Affected: {affectedNames}.
            </span>
          )}
          {latestRunAt && (
            <span className="ml-1 opacity-60">
              As of{" "}
              {new Date(latestRunAt).toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })}
              .
            </span>
          )}
          {data.statusPageUrl && (
            <a
              href={data.statusPageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 underline underline-offset-2 hover:opacity-80"
            >
              View Status
            </a>
          )}
        </p>

        <StatusBannerDismissButton bannerId={bannerId} dismissKey={dismissKey} />
      </div>
      <script
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: initScript }}
      />
    </>
  );
}
