import { Suspense } from "react";
import { HeaderAuthButtons } from "./HeaderAuthButtons";
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
        <Suspense fallback={<HeaderAuthButtons user={null} />}>
          <HeaderAuthSlot />
        </Suspense>
      }
    />
  );
}
