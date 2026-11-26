import { memo, useRef, type MouseEvent, type PointerEvent } from "react";
import { YardPath } from "~/lib/yard-path";
import type { MapYard } from "./yard-map-data";

/**
 * A yard on the map. A press that turns into a pan of the map does not
 * count as a click, so dragging from a pin never selects it. `onSelect` gets
 * the click, so the map can tell a tap on stacked dots from a tap on one
 * pin; keyboard activation has `detail` 0.
 *
 * The marker canvas draws the yard; the pin is its invisible 32px hit box,
 * Tab stop and label, centered on `x`, `y` in the pin layer. Memoized with
 * stable callbacks from the map: a tap or a pan then redraws only the pins
 * whose Tab stop or selection changed, not all of them.
 */
export const YardMapPin = memo(function YardMapPin({
  yard,
  x,
  y,
  selected,
  tabIndex,
  onSelect,
  register,
  onFocusYard,
  onHoverYard,
}: {
  yard: MapYard;
  /** The yard's place in the pin layer, in pixels. */
  x: number;
  y: number;
  selected: boolean;
  tabIndex: 0 | -1;
  onSelect: (yard: MapYard, event: MouseEvent<HTMLButtonElement>) => void;
  /** Called with the pin's button, and with null when it unmounts. */
  register: (key: string, button: HTMLButtonElement | null) => void;
  onFocusYard: (key: string) => void;
  /** A mouse moved onto (true) or off (false) the pin. */
  onHoverYard: (key: string, hovered: boolean) => void;
}) {
  const key = YardPath.key(yard);
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
      style={{ left: x - 16, top: y - 16 }}
      ref={(button) => register(key, button)}
      tabIndex={tabIndex}
      onFocus={() => onFocusYard(key)}
      className="yard-map-pin pigeon-click-block"
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
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") onHoverYard(key, true);
      }}
      onPointerLeave={() => onHoverYard(key, false)}
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
        onSelect(yard, event);
      }}
    />
  );
});
