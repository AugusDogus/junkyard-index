"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { signOut } from "~/lib/auth-client";
import { api } from "~/trpc/react";

export function DeleteAccountCard() {
  const router = useRouter();
  const [showDialog, setShowDialog] = useState(false);
  const deleteAccount = api.user.deleteAccount.useMutation({
    onSuccess: async () => {
      await signOut();
      router.push("/");
      router.refresh();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  return (
    <>
      <section
        aria-labelledby="delete-account-heading"
        className="border-border border-t pt-10"
      >
        <div className="max-w-2xl">
          <h2 id="delete-account-heading" className="text-xl font-semibold">
            Delete account
          </h2>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            Permanently delete your account and all associated data, including
            saved searches and alerts. Any subscription that could still charge
            will be revoked first. Unfinished checkouts must expire or complete
            before deletion. This action cannot be undone.
          </p>
        </div>
        <div className="mt-6">
          <Button variant="destructive" onClick={() => setShowDialog(true)}>
            <Trash2 data-icon="inline-start" />
            Delete account
          </Button>
        </div>
      </section>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete account</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete your account? This action cannot
              be undone. Your access will end immediately, your saved searches
              and alerts will be deleted, and any subscription that could still
              charge will be revoked. Deletion will stop if billing status or
              revocation cannot be confirmed, or if a checkout is unfinished.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDialog(false)}
              disabled={deleteAccount.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteAccount.mutate()}
              disabled={deleteAccount.isPending}
            >
              {deleteAccount.isPending ? "Deleting..." : "Delete account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
