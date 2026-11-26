import {
  useRef,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import type { MapYard } from "./yard-map-data";

type MarkerButtonProps = {
  tabIndex: 0 | -1;
  buttonRef?: Ref<HTMLButtonElement>;
  onFocus?: () => void;
};

/**
 * A map marker's button. A press that turns into a pan of the map does not
 * count as a click, so dragging from a pin or group never selects it.
 */
function MarkerButton({
  tabIndex,
  buttonRef,
  onFocus,
  className,
  label,
  title,
  pressed,
  onActivate,
  children,
}: MarkerButtonProps & {
  className: string;
  label: string;
  title: string;
  pressed?: boolean;
  onActivate: () => void;
  children: ReactNode;
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
      ref={buttonRef}
      tabIndex={tabIndex}
      onFocus={onFocus}
      className={className}
      aria-label={label}
      aria-pressed={pressed}
      title={title}
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
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        // Keyboard and assistive-technology activation have no pointer clicks.
        if (event.detail !== 0 && gesture.current?.dragged) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onActivate();
      }}
    >
      {children}
    </button>
  );
}

export function YardMapPin({
  yard,
  selected,
  onSelect,
  ...button
}: MarkerButtonProps & {
  yard: MapYard;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <MarkerButton
      {...button}
      className="yard-map-pin"
      label={`${yard.name}, ${yard.city}, ${yard.state}`}
      title={`${yard.name} · ${yard.vehicleCount.toLocaleString("en-US")} vehicles`}
      pressed={selected}
      onActivate={onSelect}
    >
      <span aria-hidden="true" />
    </MarkerButton>
  );
}

/** A numbered group of yards too close to pick apart; opening it zooms in. */
export function YardMapCluster({
  yards,
  onOpen,
  ...button
}: MarkerButtonProps & {
  yards: MapYard[];
  onOpen: () => void;
}) {
  const vehicles = yards.reduce((total, yard) => total + yard.vehicleCount, 0);
  const states = [...new Set(yards.map((yard) => yard.state))].join(", ");
  return (
    <MarkerButton
      {...button}
      className="yard-map-pin yard-map-cluster"
      label={`${yards.length} yards in ${states}. Zoom in to pick one.`}
      title={`${yards.length} yards · ${vehicles.toLocaleString("en-US")} vehicles`}
      onActivate={onOpen}
    >
      <span aria-hidden="true">{yards.length}</span>
    </MarkerButton>
  );
}
