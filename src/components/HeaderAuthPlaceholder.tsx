import { HeaderAuthButtons } from "~/components/HeaderAuthButtons";

/** An inert copy of the signed-out header controls, holding their space. */
export function HeaderAuthPlaceholder() {
  return (
    <div className="invisible" aria-hidden="true" inert>
      <HeaderAuthButtons user={null} />
    </div>
  );
}
