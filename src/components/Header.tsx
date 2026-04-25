import { Suspense } from "react";
import { Skeleton } from "~/components/ui/skeleton";
import { HeaderContent } from "./HeaderContent";
import { HeaderAuthSlot, HeaderStatusSlot } from "./HeaderServerSlots";

export function Header() {
  return (
    <HeaderContent
      statusSlot={
        <Suspense fallback={null}>
          <HeaderStatusSlot />
        </Suspense>
      }
      authSlot={
        <Suspense fallback={<HeaderAuthSkeleton />}>
          <HeaderAuthSlot />
        </Suspense>
      }
    />
  );
}

function HeaderAuthSkeleton() {
  return (
    <div className="flex items-center gap-2">
      <Skeleton className="hidden h-8 w-16 sm:block" />
      <Skeleton className="h-8 w-32" />
    </div>
  );
}
