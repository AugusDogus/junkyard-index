import { Skeleton } from "~/components/ui/skeleton";

export function SearchPageSkeleton() {
  return (
    <div
      className="shell min-h-screen"
      aria-busy="true"
      aria-label="Loading search"
    >
      <div className="space-y-3 py-3">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
      <Skeleton className="my-3 h-9 w-44" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="my-6 h-8 w-56" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="overflow-hidden rounded-xl border">
            <Skeleton className="aspect-video rounded-none" />
            <div className="space-y-4 p-4">
              <Skeleton className="h-7 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
