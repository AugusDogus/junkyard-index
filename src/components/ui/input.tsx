import * as React from "react";

import { cn } from "~/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-figure selection:text-board border-input bg-card h-9 w-full min-w-0 rounded-md border px-3 py-1 text-base outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
        "aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
