"use client";

import { AlertTriangle, Info } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { useIsMobile } from "~/hooks/use-media-query";

export interface HeaderStatusData {
  aggregateStatus: "operational" | "in_progress" | "degraded" | "down";
  message: string;
  affected: string;
  statusPageUrl: string | null;
}

function StatusIcon({
  isDegraded,
  isInProgress,
}: {
  isDegraded: boolean;
  isInProgress: boolean;
}) {
  return isDegraded || isInProgress ? (
    <Info className="size-5" />
  ) : (
    <AlertTriangle className="size-5" />
  );
}

function StatusLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 block underline underline-offset-2"
    >
      View Status Page
    </a>
  );
}

export function HeaderStatusIndicator({ data }: { data: HeaderStatusData }) {
  const isMobile = useIsMobile();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (data.aggregateStatus === "operational") return null;

  const isInProgress = data.aggregateStatus === "in_progress";
  const isDegraded = data.aggregateStatus === "degraded";
  const colorClass = isInProgress
    ? "text-sky-500 dark:text-sky-400"
    : isDegraded
      ? "text-amber-500 dark:text-amber-400"
      : "text-red-500 dark:text-red-400";
  const ariaLabel = isInProgress
    ? "Ingestion currently in progress"
    : isDegraded
      ? "Provider status degraded"
      : "Provider status disruption";
  const title = isInProgress
    ? "Ingestion In Progress"
    : isDegraded
      ? "Service Degraded"
      : "Service Disruption";

  if (isMobile) {
    return (
      <>
        <button
          type="button"
          className={colorClass}
          onClick={() => setDialogOpen(true)}
          aria-label={ariaLabel}
        >
          <StatusIcon isDegraded={isDegraded} isInProgress={isInProgress} />
        </button>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className={colorClass}>{title}</DialogTitle>
              <DialogDescription>
                {data.message}
                <br />
                Affected: {data.affected}.
              </DialogDescription>
            </DialogHeader>
            {data.statusPageUrl && <StatusLink url={data.statusPageUrl} />}
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={colorClass}
          aria-label={ariaLabel}
        >
          <StatusIcon isDegraded={isDegraded} isInProgress={isInProgress} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <p>{data.message}</p>
        <p className="mt-0.5 opacity-75">Affected: {data.affected}.</p>
        {data.statusPageUrl && <StatusLink url={data.statusPageUrl} />}
      </TooltipContent>
    </Tooltip>
  );
}
