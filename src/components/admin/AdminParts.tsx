import Link from "next/link";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { AdminLinkPending } from "./AdminLinkPending";
import type { Loaded } from "~/server/admin/admin-data";
import type {
  IngestionFlag,
  SourceState,
} from "~/server/admin/source-overview";
import type { RunOutcome } from "~/server/admin/source-run";

export function AdminPageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="border-border border-b pb-6">
      <h1 className="text-3xl font-medium text-balance">{title}</h1>
      <p className="text-muted-foreground mt-3 max-w-2xl text-base leading-7 text-pretty">
        {description}
      </p>
    </header>
  );
}

export function AdminSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const id = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-heading`;
  return (
    <section aria-labelledby={id} className="min-w-0">
      <h2 id={id} className="text-xl font-medium">
        {title}
      </h2>
      {description && (
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
          {description}
        </p>
      )}
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** A plain-words line with the raw text behind a toggle. */
export function RawText({
  summary,
  raw,
  label = "Show full error",
}: {
  summary: ReactNode;
  raw: string | null;
  label?: string;
}) {
  return (
    <div className="min-w-0">
      <div>{summary}</div>
      {raw !== null && raw.trim() !== "" && (
        <details className="mt-1">
          <summary className="text-muted-foreground cursor-pointer text-xs">
            {label}
          </summary>
          <pre className="bg-muted mt-2 max-h-96 overflow-auto rounded-md p-3 text-xs break-words whitespace-pre-wrap">
            {raw}
          </pre>
        </details>
      )}
    </div>
  );
}

/** A part of the page that could not load, in plain words. */
export function LoadFailure({
  failure,
}: {
  failure: Extract<Loaded<unknown>, { status: "failed" }>;
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Could not load {failure.what}</AlertTitle>
      <AlertDescription>
        <RawText
          summary="Nothing was changed. Reload the page to try again; if it keeps failing, the details below say why."
          raw={failure.message}
          label="Show details"
        />
      </AlertDescription>
    </Alert>
  );
}

/** Renders a loaded part, or its failure. */
export function WhenLoaded<Value>({
  loaded,
  children,
}: {
  loaded: Loaded<Value>;
  children: (value: Value) => ReactNode;
}) {
  return loaded.status === "ok" ? (
    children(loaded.value)
  ) : (
    <LoadFailure failure={loaded} />
  );
}

export const SOURCE_STATE_LABELS: Record<SourceState, string> = {
  failing: "Failing",
  stale: "Out of date",
  running: "Running",
  paused: "Paused",
  waiting: "Not updated yet today",
  accepted_today: "Updated today",
  retired: "Retired",
};

const STATE_VARIANTS = {
  failing: "destructive",
  stale: "destructive",
  running: "secondary",
  paused: "outline",
  waiting: "outline",
  accepted_today: "default",
  retired: "outline",
} as const satisfies Record<
  SourceState,
  "default" | "secondary" | "destructive" | "outline"
>;

export function SourceStateBadge({ state }: { state: SourceState }) {
  return (
    <Badge variant={STATE_VARIANTS[state]}>{SOURCE_STATE_LABELS[state]}</Badge>
  );
}

export function OutcomeLabel({ outcome }: { outcome: RunOutcome }) {
  switch (outcome.kind) {
    case "accepted":
      return <span>Accepted</span>;
    case "running":
      return <span>Running</span>;
    case "rejected":
      return <span className="text-destructive">Rejected</span>;
  }
}

export const FLAG_LABELS: Record<IngestionFlag, string> = {
  on: "On: runs daily",
  off: "Off: paused, no new runs",
  unknown: "Could not read the flag; runs as if on",
};

export function SourceLink({
  source,
  children,
}: {
  source: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={`/admin/sources/${source}`}
      className="inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"
    >
      {children}
      <AdminLinkPending />
    </Link>
  );
}

/** A labelled figure for the overview. */
export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg border p-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="mt-1 text-2xl font-medium tabular-nums">{value}</dd>
      {hint !== undefined && (
        <dd className="text-muted-foreground mt-1 text-xs leading-5">{hint}</dd>
      )}
    </div>
  );
}

/** Rows of label and value, as settings pages list details. */
export function DetailList({
  rows,
}: {
  rows: readonly { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="border-border divide-y border-y">
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid gap-1 py-3 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-6"
        >
          <dt className="text-muted-foreground text-sm">{row.label}</dt>
          <dd className="min-w-0 text-sm font-medium break-words">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function formatCount(value: number | null): string {
  return value === null ? "Unknown" : value.toLocaleString("en-US");
}

export function formatChange(value: number | null): string {
  if (value === null) return "Unknown";
  if (value === 0) return "No change";
  return `${value > 0 ? "+" : ""}${value.toLocaleString("en-US")}`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "Still running";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "Under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}
