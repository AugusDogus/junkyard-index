"use client";

import { AlertDialog } from "radix-ui";
import { useState } from "react";
import { Button } from "~/components/ui/button";

export function DeleteSavedSearchDialog({
  searchName,
  disabled,
  onDelete,
}: {
  searchName: string;
  disabled: boolean;
  onDelete: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setError(undefined);
        setOpen(next);
      }}
    >
      <AlertDialog.Trigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11"
          disabled={disabled}
          aria-label={`Delete saved search ${searchName}`}
        >
          Delete
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[80] bg-black/50" />
        <AlertDialog.Content className="bg-background fixed top-1/2 left-1/2 z-[80] grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border p-6 shadow-lg sm:max-w-md">
          <AlertDialog.Title className="text-lg font-semibold text-balance break-words">
            Delete “{searchName}”?
          </AlertDialog.Title>
          <AlertDialog.Description className="text-muted-foreground text-sm text-pretty">
            This removes the saved search and stops its email and Discord
            alerts. You can’t undo this.
          </AlertDialog.Description>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="outline" disabled={pending}>
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                setError(undefined);
                try {
                  await onDelete();
                  setOpen(false);
                } catch {
                  setError(
                    "Deletion could not be confirmed. Try again, or refresh to check whether this search is still saved.",
                  );
                } finally {
                  setPending(false);
                }
              }}
            >
              {pending ? "Deleting…" : "Delete search"}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
