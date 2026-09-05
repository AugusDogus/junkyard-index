import { useRef, type PointerEvent } from "react";
import type { HomepageYard } from "~/lib/homepage-inventory";

export function YardMapPin({
  yard,
  selected,
  onSelect,
}: {
  yard: HomepageYard;
  selected: boolean;
  onSelect: () => void;
}) {
  const gesture = useRef<{
    pointerId: number;
    x: number;
    y: number;
    dragged: boolean;
  } | null>(null);

  const trackPointer = (event: PointerEvent<HTMLButtonElement>) => {
    const current = gesture.current;
    if (current?.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 5) {
      current.dragged = true;
    }
  };

  return (
    <button
      type="button"
      className="yard-map-pin"
      aria-label={`${yard.name}, ${yard.city}, ${yard.state}`}
      aria-pressed={selected}
      title={`${yard.name} · ${yard.vehicleCount.toLocaleString("en-US")} vehicles`}
      onPointerDown={(event) => {
        if (!event.isPrimary) {
          if (gesture.current) gesture.current.dragged = true;
          return;
        }
        if (event.button !== 0) return;
        gesture.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          dragged: false,
        };
        // Continue tracking outside the pin without blocking Pigeon's pan events.
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={trackPointer}
      onPointerUp={trackPointer}
      onPointerCancel={() => {
        if (gesture.current) gesture.current.dragged = true;
      }}
      onClick={(event) => {
        // Keyboard and assistive-technology activation have no pointer clicks.
        if (event.detail !== 0 && gesture.current?.dragged) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onSelect();
      }}
    >
      <span aria-hidden="true" />
    </button>
  );
}
