"use client";

import { useState } from "react";
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
import { Bookmark } from "lucide-react";
import { api } from "~/trpc/react";
import { toast } from "sonner";

interface SaveSearchDialogProps {
  query: string;
  filters: {
    makes?: string[];
    colors?: string[];
    states?: string[];
    salvageYards?: string[];
    minYear?: number;
    maxYear?: number;
    sortBy?: string;
  };
  disabled?: boolean;
}

export function SaveSearchDialog({
  query,
  filters,
  disabled,
}: SaveSearchDialogProps) {
  const [open, setOpen] = useState(false);
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled || !query}>
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
