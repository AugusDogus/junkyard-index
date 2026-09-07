"use client";

import { useId, useState } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";

export function InlineBuilder({
  text,
  builder,
  pending,
  valid,
}: {
  text: ReactNode;
  builder: ReactNode;
  pending: boolean;
  valid: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="se-inline">
      <div className="se-disclosure">
        <button
          type="button"
          className="se-disclosure-trigger"
          aria-expanded={open}
          aria-controls={id}
          disabled={pending || (!valid && !open)}
          onClick={() => setOpen(!open)}
        >
          <SlidersHorizontal size={16} />
          <span>
            <strong>Search builder</strong>
            <small>Edit the conditions in this expression</small>
          </span>
          <ChevronDown size={16} />
        </button>
        {open && (
          <div id={id} className="se-disclosure-body">
            {builder}
          </div>
        )}
      </div>
      {text}
    </div>
  );
}
