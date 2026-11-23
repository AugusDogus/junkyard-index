import type { ReactNode } from "react";
import { Skeleton } from "~/components/ui/skeleton";

// Shown by the admin loading.tsx files while a page's data loads. They sit
// inside the admin layout, so a non-admin never sees one: requireAdmin
// answers with the 404 first. But Next.js still sends each segment's loading
// UI in the route's payload, 404 included (seen with Next 16.1 signed out),
// so these hold shapes only: no admin labels, names or data.

function Loading({ children }: { children: ReactNode }) {
  return (
    <div aria-busy="true" className="space-y-12">
      <p role="status" className="sr-only">
        Loading
      </p>
      {children}
    </div>
  );
}

/** AdminPageHeader's shape: a title over a two-line description. */
function HeaderSkeleton() {
  return (
    <div className="border-border border-b pb-6">
      <Skeleton className="h-9 w-56 max-w-full" />
      <div className="mt-4 max-w-2xl space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}

/** AdminSection's shape: a heading, then its content. */
function SectionSkeleton({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-0">
      <Skeleton className="h-6 w-40" />
      <div className="mt-5">{children}</div>
    </div>
  );
}

function StatsSkeleton({
  count,
  className,
}: {
  count: number;
  className: string;
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="min-w-0 rounded-lg border p-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-2 h-7 w-12" />
        </div>
      ))}
    </div>
  );
}

function DetailListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="border-border divide-y border-y">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="grid gap-1 py-3 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-6"
        >
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-40 max-w-full" />
        </div>
      ))}
    </div>
  );
}

function TableSkeleton({ rows, columns }: { rows: number; columns: number }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="bg-muted/50 flex gap-6 px-3 py-2.5">
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={index} className="h-3 flex-1" />
        ))}
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex gap-6 px-3 py-4">
            {Array.from({ length: columns }, (_, column) => (
              <Skeleton key={column} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdminOverviewSkeleton() {
  return (
    <Loading>
      <HeaderSkeleton />
      <SectionSkeleton>
        <Skeleton className="h-20 w-full" />
      </SectionSkeleton>
      <SectionSkeleton>
        <StatsSkeleton
          count={7}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3"
        />
      </SectionSkeleton>
      <SectionSkeleton>
        <StatsSkeleton
          count={3}
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
        />
      </SectionSkeleton>
    </Loading>
  );
}

export function AdminSourcesSkeleton() {
  return (
    <Loading>
      <HeaderSkeleton />
      <TableSkeleton rows={12} columns={6} />
    </Loading>
  );
}

export function AdminSourceSkeleton() {
  return (
    <Loading>
      <div>
        <Skeleton className="mb-4 h-5 w-24" />
        <HeaderSkeleton />
      </div>
      <SectionSkeleton>
        <DetailListSkeleton rows={5} />
      </SectionSkeleton>
      <SectionSkeleton>
        <DetailListSkeleton rows={2} />
      </SectionSkeleton>
      <SectionSkeleton>
        <div className="divide-y rounded-lg border">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="grid gap-2 p-4">
              <div className="flex justify-between gap-4">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-32" />
              </div>
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
          ))}
        </div>
      </SectionSkeleton>
    </Loading>
  );
}

/** Pages of figures and charts: budgets and analytics. */
export function AdminFiguresSkeleton() {
  return (
    <Loading>
      <HeaderSkeleton />
      <SectionSkeleton>
        <StatsSkeleton
          count={3}
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
        />
      </SectionSkeleton>
      <SectionSkeleton>
        <Skeleton className="h-48 w-full" />
      </SectionSkeleton>
    </Loading>
  );
}

export function AdminSearchSkeleton() {
  return (
    <Loading>
      <HeaderSkeleton />
      <SectionSkeleton>
        <DetailListSkeleton rows={5} />
      </SectionSkeleton>
      <SectionSkeleton>
        <TableSkeleton rows={6} columns={4} />
      </SectionSkeleton>
      <SectionSkeleton>
        <DetailListSkeleton rows={2} />
      </SectionSkeleton>
    </Loading>
  );
}
