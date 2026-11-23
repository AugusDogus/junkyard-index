import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { SearchYardSelection } from "~/lib/search-yard-selection";
import { cn } from "~/lib/utils";
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
          <div className="flex flex-wrap items-center gap-2">
            {expressionOwnsTypes && (
              <span className="text-muted-foreground w-full text-xs sm:w-auto">
                Additional yard filter
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              className={cn(
                "min-h-11 px-1.5 text-xs sm:min-h-9 sm:px-2 sm:text-sm",
                types.length === 0 && "bg-ink text-paper",
              )}
              aria-label="All yards, including unclassified"
              aria-pressed={types.length === 0}
              onClick={() => onChange([])}
            >
              All yards
            </Button>
            {YARD_TYPE_OPTIONS.map(({ value, label }) => (
              <label
                key={value}
                className={cn(
                  "border-ink flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border-2 px-1 text-xs font-medium has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus sm:min-h-9 sm:px-2 sm:text-sm",
                  types.includes(value) && "bg-ink text-paper",
                )}
              >
                <Checkbox
                  checked={types.includes(value)}
                  onCheckedChange={(checked) =>
                    onChange(
                      checked === true
                        ? [...types, value]
                        : types.filter((type) => type !== value),
                    )
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <p className="text-muted-foreground text-xs text-pretty">
            Select one or both service types. All yards also includes
            unclassified yards.
          </p>
        </>
      )}
    </div>
  );
}
