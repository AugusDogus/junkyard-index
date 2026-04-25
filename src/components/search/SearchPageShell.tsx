import { Skeleton } from "~/components/ui/skeleton";

export function SearchPageShell() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-4">
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>

      <div className="relative flex w-full gap-4 md:gap-6">
        <div className="sticky top-24 hidden h-fit w-64 shrink-0 lg:block lg:w-80">
          <div className="rounded-xl border p-4">
            <Skeleton className="h-6 w-24" />
            <div className="mt-4 space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-4 flex flex-wrap gap-2">
            <Skeleton className="h-10 w-36" />
            <Skeleton className="h-10 w-28" />
            <Skeleton className="h-10 w-24" />
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="rounded-xl border p-4">
                <Skeleton className="aspect-[4/3] w-full rounded-lg" />
                <Skeleton className="mt-4 h-5 w-2/3" />
                <Skeleton className="mt-2 h-4 w-full" />
                <Skeleton className="mt-2 h-4 w-5/6" />
                <Skeleton className="mt-4 h-9 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
