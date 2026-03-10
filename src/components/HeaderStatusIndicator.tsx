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

function StatusIcon({ isDegraded }: { isDegraded: boolean }) {
  return isDegraded ? (
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

  const isDegraded =
    data.aggregateStatus === "degraded" ||
    data.aggregateStatus === "in_progress";
  const colorClass = isDegraded
    ? "text-amber-500 dark:text-amber-400"
    : "text-red-500 dark:text-red-400";

  if (isMobile) {
    return (
      <>
        <button
          type="button"
          className={colorClass}
          onClick={() => setDialogOpen(true)}
          aria-label="Provider status issue"
        >
          <StatusIcon isDegraded={isDegraded} />
        </button>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className={colorClass}>
                {isDegraded ? "Service Degraded" : "Service Disruption"}
              </DialogTitle>
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
          aria-label="Provider status issue"
        >
          <StatusIcon isDegraded={isDegraded} />
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
