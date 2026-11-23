import { Button } from "~/components/ui/button";
import { SearchYardSelection } from "~/lib/search-yard-selection";
import { YARD_TYPE_OPTIONS, type YardType } from "~/lib/yard-service";

// Matches ArrivalWindowChips, so both rows read as one set of toggles.
const TOGGLE_CLASS = "min-h-11 px-1 sm:min-h-9 sm:px-3";

export function SearchYardTypeControls({
  types,
  expression,
  onChange,
  onEditExpression,
}: {
  types: YardType[];
  expression?: string;
  onChange(types: YardType[]): void;
  onEditExpression(): void;
}) {
  const expressionOwnsTypes =
    expression !== undefined &&
    SearchYardSelection.expressionTypes(expression).length > 0;
  return (
    <div
      role="group"
      className="flex flex-col items-start gap-2"
      aria-label="Yard type"
    >
      {expressionOwnsTypes && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span>Yard types set in advanced search</span>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="px-0"
            onClick={onEditExpression}
          >
            Edit yard types
          </Button>
        </div>
      )}
      {(!expressionOwnsTypes || types.length > 0) && (
        <>
          {expressionOwnsTypes && (
            <span className="text-muted-foreground text-xs">
              Additional yard filter
            </span>
          )}
          <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:flex-wrap">
            <Button
              type="button"
              size="sm"
              className={TOGGLE_CLASS}
              variant={types.length === 0 ? "default" : "outline"}
              aria-label="All yards, including unclassified"
              title="Includes yards not yet classified as self-service or full-service"
              aria-pressed={types.length === 0}
              onClick={() => onChange([])}
            >
              All yards
            </Button>
            {/* Self-service and full-service combine; neither means all. */}
            {YARD_TYPE_OPTIONS.map(({ value, label }) => {
              const pressed = types.includes(value);
              return (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  className={TOGGLE_CLASS}
                  variant={pressed ? "default" : "outline"}
                  aria-pressed={pressed}
                  onClick={() =>
                    onChange(
                      pressed
                        ? types.filter((type) => type !== value)
                        : [...types, value],
                    )
                  }
                >
                  {label}
                </Button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
