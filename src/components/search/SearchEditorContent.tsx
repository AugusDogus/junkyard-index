import type { ComponentProps } from "react";
import { DialogContent } from "~/components/ui/dialog";
import { cn } from "~/lib/utils";

/** A full-height editor on phones and a bounded, scrollable dialog on larger screens. */
export function SearchEditorContent({
  className,
  ...props
}: ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      {...props}
      className={cn(
        "flex h-dvh max-h-dvh max-w-full flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-4xl sm:rounded-lg",
        className,
      )}
    />
  );
}
