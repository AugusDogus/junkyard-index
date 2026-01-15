"use client";

import { Bookmark } from "lucide-react";
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
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { api } from "~/trpc/react";

const PENDING_SAVE_KEY = "pendingSaveSearch";

export interface SaveSearchFilters {
  makes?: string[];
  colors?: string[];
  states?: string[];
  salvageYards?: string[];
  minYear?: number;
  maxYear?: number;
  sortBy?: string;
}

interface SaveSearchDialogProps {
  query: string;
  filters: SaveSearchFilters;
  disabled?: boolean;
  isLoggedIn?: boolean;
  autoOpen?: boolean;
  onAutoOpenHandled?: () => void;
}

export function storePendingSaveSearch(query: string, filters: SaveSearchFilters) {
  sessionStorage.setItem(PENDING_SAVE_KEY, JSON.stringify({ query, filters }));
}

export function getPendingSaveSearch(): { query: string; filters: SaveSearchFilters } | null {
  const stored = sessionStorage.getItem(PENDING_SAVE_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as { query: string; filters: SaveSearchFilters };
  } catch {
    return null;
  }
}

export function clearPendingSaveSearch() {
  sessionStorage.removeItem(PENDING_SAVE_KEY);
}

export function SaveSearchDialog({
  query,
  filters,
  disabled,
  isLoggedIn,
  autoOpen,
  onAutoOpenHandled,
}: SaveSearchDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(() => {
    if (autoOpen && isLoggedIn) {
      onAutoOpenHandled?.();
      return true;
    }
    return false;
  });
  const [name, setName] = useState("");

  const utils = api.useUtils();
  const createMutation = api.savedSearches.create.useMutation({
    onSuccess: () => {
      toast.success("Search saved!");
      setOpen(false);
      setName("");
      void utils.savedSearches.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to save search");
    },
  });

  const handleSave = () => {
    if (!name.trim()) return;
    createMutation.mutate({
      name: name.trim(),
      query,
      filters,
    });
  };

  const handleButtonClick = () => {
    if (isLoggedIn) {
      setOpen(true);
    } else {
      storePendingSaveSearch(query, filters);
      const returnTo = encodeURIComponent(window.location.pathname + window.location.search + "&saveSearch=1");
      router.push(`/auth/sign-in?returnTo=${returnTo}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || !query}
          onClick={(e) => {
            if (!isLoggedIn) {
              e.preventDefault();
              handleButtonClick();
            }
          }}
        >
          <Bookmark className="mr-2 h-4 w-4" />
          Save Search
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Save Search</DialogTitle>
          <DialogDescription>
            Save this search to quickly access it later.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="e.g., Honda Civic 2018+"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
            />
          </div>
          <div className="text-muted-foreground text-sm">
            <p>
              <strong>Query:</strong> {query || "(empty)"}
            </p>
            {filters.makes && filters.makes.length > 0 && (
              <p>
                <strong>Makes:</strong> {filters.makes.join(", ")}
              </p>
            )}
            {filters.colors && filters.colors.length > 0 && (
              <p>
                <strong>Colors:</strong> {filters.colors.join(", ")}
              </p>
            )}
            {filters.states && filters.states.length > 0 && (
              <p>
                <strong>States:</strong> {filters.states.join(", ")}
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={handleSave}
            disabled={!name.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
