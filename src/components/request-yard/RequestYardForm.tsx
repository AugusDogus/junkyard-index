"use client";

import { AlertCircle, CheckCircle, Send, Warehouse } from "lucide-react";
import { useState } from "react";
import posthog from "posthog-js";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { api } from "~/trpc/react";

type FormState =
  | { kind: "idle" | "submitting" | "success" }
  | { kind: "error"; message: string };

export function RequestYardForm({
  initialEmail = "",
}: {
  initialEmail?: string;
}) {
  const [formState, setFormState] = useState<FormState>({ kind: "idle" });
  const [yardName, setYardName] = useState("");
  const [website, setWebsite] = useState("");
  const [email, setEmail] = useState(initialEmail);

  const createRequest = api.yardRequests.create.useMutation({
    onSuccess: () => {
      setFormState({ kind: "success" });
      setYardName("");
      setWebsite("");
      setEmail(initialEmail);
    },
    onError: (error) => {
      const fieldErrors = error.data?.zodError?.fieldErrors;
      const firstIssue = fieldErrors
        ? Object.values(fieldErrors)
            .flat()
            .find((message): message is string => typeof message === "string")
        : undefined;
      setFormState({
        kind: "error",
        message: firstIssue ?? error.message,
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormState({ kind: "submitting" });

    createRequest.mutate({
      yardName,
      website: website.trim() || undefined,
      requesterEmail: email.trim() || undefined,
      clientDistinctId: posthog.get_distinct_id(),
    });
  };

  return (
    <>
      <div className="mb-8 text-center">
        <div className="bg-primary/10 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
          <Warehouse className="text-primary h-6 w-6" />
        </div>
        <h1 className="mb-2 text-3xl font-bold tracking-tight">
          Request a Yard
        </h1>
        <p className="text-muted-foreground text-balance">
          Know a salvage yard we don&apos;t have yet? Tell us the name and
          we&apos;ll look into adding it.
        </p>
      </div>

      {formState.kind === "success" ? (
        <div className="bg-card rounded-lg border p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
            <CheckCircle className="h-6 w-6 text-green-500" />
          </div>
          <h2 className="mb-2 text-xl font-semibold">Request Received!</h2>
          <p className="text-muted-foreground mb-6">
            Thanks for the suggestion. We&apos;ll review it and reach out if we
            add the yard.
          </p>
          <Button
            variant="outline"
            onClick={() => setFormState({ kind: "idle" })}
          >
            Request Another Yard
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {formState.kind === "error" && (
            <div className="border-destructive/50 bg-destructive/10 text-destructive flex items-center gap-2 rounded-lg border p-4 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {formState.message}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="yardName">Yard name</Label>
            <Input
              id="yardName"
              type="text"
              placeholder="e.g. Ace Auto Salvage"
              required
              minLength={2}
              maxLength={200}
              value={yardName}
              onChange={(e) => setYardName(e.target.value)}
              disabled={formState.kind === "submitting"}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="website">Website</Label>
            <Input
              id="website"
              type="text"
              placeholder="https://... (if they have one)"
              maxLength={500}
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              disabled={formState.kind === "submitting"}
            />
            <p className="text-muted-foreground text-xs">Optional.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Your email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={formState.kind === "submitting"}
            />
            <p className="text-muted-foreground text-xs">
              Optional. Only if you&apos;d like us to follow up.
            </p>
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={formState.kind === "submitting"}
          >
            {formState.kind === "submitting" ? (
              "Submitting..."
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Submit Request
              </>
            )}
          </Button>
        </form>
      )}
    </>
  );
}
