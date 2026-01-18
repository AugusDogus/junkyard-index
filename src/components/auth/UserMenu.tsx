"use client";

import { CreditCard, LogOut, Monitor, Moon, Settings, Sun, Trash2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "~/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { authClient, signOut, useSession } from "~/lib/auth-client";
import { api } from "~/trpc/react";

interface UserMenuProps {
  user?: { name: string; email: string; image?: string | null } | null;
}

export function UserMenu({ user: initialUser }: UserMenuProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const { setTheme } = useTheme();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Use session user if available (for real-time updates), otherwise fall back to initial user
  const user = session?.user ?? initialUser;

  // Check subscription status using tRPC
  const { data: subscriptionData } = api.subscription.getCustomerState.useQuery();

  const deleteAccountMutation = api.user.deleteAccount.useMutation({
    onSuccess: async () => {
      await signOut();
      router.push("/");
      router.refresh();
    },
  });

  const hasActiveSubscription = subscriptionData?.hasActiveSubscription ?? false;

  const handleManageSubscription = async () => {
    try {
      await authClient.customer?.portal();
    } catch (error) {
      console.error("Failed to open customer portal:", error);
    }
  };

  const handleSubscribe = async () => {
    try {
      await authClient.checkout({
        slug: "Email-Notifications",
      });
    } catch (error) {
      console.error("Failed to open checkout:", error);
    }
  };

  if (!user) {
    return null;
  }

  const handleSignOut = async () => {
    setIsSigningOut(true);
    await signOut();
    router.refresh();
  };

  const handleDeleteAccount = () => {
    deleteAccountMutation.mutate();
  };

  const initials = user.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || user.email[0]?.toUpperCase() || "U";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="relative h-8 w-8 rounded-full p-0"
          >
            {user.image ? (
              <img
                src={user.image}
                alt={user.name || user.email}
                className="h-8 w-8 rounded-full"
              />
            ) : (
              <span className="text-xs font-medium">
                {initials}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56" align="end">
          <DropdownMenuLabel>
            <div className="flex flex-col space-y-1">
              {user.name && (
                <p className="text-sm font-medium leading-none">{user.name}</p>
              )}
              <p className="text-muted-foreground text-xs leading-none">
                {user.email}
              </p>
            </div>
          </DropdownMenuLabel>
          {/* Theme submenu - visible on mobile, hidden on desktop */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2 sm:hidden">
              <Sun className="h-4 w-4 scale-100 rotate-0 dark:scale-0 dark:-rotate-90" />
              <Moon className="absolute h-4 w-4 scale-0 rotate-90 dark:scale-100 dark:rotate-0" />
              Theme
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => setTheme("light")}>
                <Sun className="mr-2 h-4 w-4" />
                Light
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")}>
                <Moon className="mr-2 h-4 w-4" />
                Dark
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")}>
                <Monitor className="mr-2 h-4 w-4" />
                System
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator className="sm:hidden" />
          {/* Settings */}
          <DropdownMenuItem onClick={() => router.push("/settings")}>
            <Settings className="mr-2 h-4 w-4" />
            <span>Settings</span>
          </DropdownMenuItem>
          {/* Subscription management */}
          {hasActiveSubscription ? (
            <DropdownMenuItem onClick={handleManageSubscription}>
              <CreditCard className="mr-2 h-4 w-4" />
              <span>Manage Subscription</span>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={handleSubscribe}>
              <CreditCard className="mr-2 h-4 w-4" />
              <span>Subscribe to Alerts</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            <span>Delete Account</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={isSigningOut} onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            <span>{isSigningOut ? "Signing out..." : "Sign out"}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Account</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete your account? This action cannot be undone.
              All your data, including saved searches and email alerts, will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              disabled={deleteAccountMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteAccount}
              disabled={deleteAccountMutation.isPending}
            >
              {deleteAccountMutation.isPending ? "Deleting..." : "Delete Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
