import { Button } from "~/components/ui/button";
import { Toggle } from "~/components/ui/toggle";
import { SearchYardSelection } from "~/lib/search-yard-selection";
import { YARD_TYPE_OPTIONS, type YardType } from "~/lib/yard-service";

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
    <div className="flex flex-col items-start gap-2" aria-label="Yard type">
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
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground w-full text-xs sm:w-auto">
              {expressionOwnsTypes ? "Additional yard filter" : "Yard type"}
            </span>
            <Toggle
              variant="outline"
              className="min-h-11 px-1.5 sm:min-h-9 sm:px-2"
              aria-label="All yards, including unclassified"
              pressed={types.length === 0}
              onPressedChange={() => onChange([])}
            >
              All yards
            </Toggle>
            {YARD_TYPE_OPTIONS.map(({ value, label }) => (
              <Toggle
                key={value}
                variant="outline"
                className="min-h-11 sm:min-h-9"
                pressed={types.includes(value)}
                onPressedChange={(pressed) =>
                  onChange(
                    pressed
                      ? [...types, value]
                      : types.filter((type) => type !== value),
                  )
                }
              >
                {label}
              </Toggle>
            ))}
          </div>
          {types.length === 0 && (
            <p className="text-muted-foreground w-full text-xs sm:w-auto">
              Includes yards with an unclassified service type.
            </p>
          )}
        </>
      )}
    </div>
  );
}
