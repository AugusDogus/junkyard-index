import { ARRIVAL_WINDOWS, type ArrivalWindow } from "~/lib/arrival-window";
import { Button } from "~/components/ui/button";

export function ArrivalWindowChips({
  value,
  onChange,
}: {
  value: ArrivalWindow | undefined;
  onChange: (value: ArrivalWindow | undefined) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label="Arrival window"
        className="flex flex-wrap gap-2"
      >
        <Button
          type="button"
          size="sm"
          className="min-h-11 sm:min-h-9"
          variant={value ? "outline" : "default"}
          aria-pressed={!value}
          onClick={() => onChange(undefined)}
        >
          Any arrival date
        </Button>
        {ARRIVAL_WINDOWS.map((window) => (
          <Button
            key={window.value}
            type="button"
            size="sm"
            className="min-h-11 sm:min-h-9"
            variant={value === window.value ? "default" : "outline"}
            aria-pressed={value === window.value}
            onClick={() => onChange(window.value)}
          >
            {window.label}
          </Button>
        ))}
      </div>
      {value && (
        <p className="text-muted-foreground text-xs text-pretty">
          Includes yard dates and dates first seen after a yard update (shown as
          “Seen”). Unknown arrival dates are excluded.
        </p>
      )}
    </div>
  );
}
