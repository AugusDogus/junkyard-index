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
import { cn } from "~/lib/utils";
import {
  getHeaderStatusPresentation,
  type HeaderStatus,
} from "./header-status";

export interface HeaderStatusData {
  aggregateStatus: HeaderStatus;
  affected: string;
  statusPageUrl: string | null;
}

function StatusIcon({ icon }: { icon: "info" | "warning" }) {
  return icon === "info" ? (
    <Info className="size-5" />
  ) : (
    <AlertTriangle className="size-5" />
  );
}

function StatusLink({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("mt-1 block underline underline-offset-2", className)}
    >
      View Status Page
    </a>
  );
}

export function HeaderStatusIndicator({ data }: { data: HeaderStatusData }) {
  const isMobile = useIsMobile();
  const [dialogOpen, setDialogOpen] = useState(false);
  const presentation = getHeaderStatusPresentation(data.aggregateStatus);

  if (isMobile) {
    return (
      <>
        <button
          type="button"
          className={presentation.colorClass}
          onClick={() => setDialogOpen(true)}
          aria-label={presentation.ariaLabel}
        >
          <StatusIcon icon={presentation.icon} />
        </button>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className={presentation.colorClass}>
                {presentation.title}
              </DialogTitle>
              <DialogDescription>
                {presentation.message}
                <br />
                Affected: {data.affected}.
              </DialogDescription>
            </DialogHeader>
            {data.statusPageUrl && (
              <StatusLink url={data.statusPageUrl} className="text-center" />
            )}
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
          className={presentation.colorClass}
          aria-label={presentation.ariaLabel}
        >
          <StatusIcon icon={presentation.icon} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <p>{presentation.message}</p>
        <p className="mt-0.5 opacity-75">Affected: {data.affected}.</p>
        {data.statusPageUrl && <StatusLink url={data.statusPageUrl} />}
      </TooltipContent>
    </Tooltip>
  );
}
