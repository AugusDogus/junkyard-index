"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Plus, Search } from "lucide-react";
import { Input } from "~/components/ui/input";

/** Explicit suggestions, including a selectable custom answer, in the document flow. */
export function SuggestedValue({
  label,
  suggestions,
  selected = [],
  value,
  onValueChange,
  resetOnSelect = true,
  allowCustom = true,
  onSelect,
}: {
  label: string;
  value?: string;
  onValueChange?: (value: string) => void;
  resetOnSelect?: boolean;
  allowCustom?: boolean;
  suggestions: readonly string[];
  selected?: readonly string[];
  onSelect: (value: string) => void;
}) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const [localText, setLocalText] = useState("");
  const text = value ?? localText;
  const setText = onValueChange ?? setLocalText;
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState(0);
  const clean = text.trim();
  const matches = suggestions.filter((value) =>
    value.toLowerCase().includes(clean.toLowerCase()),
  );
  const custom =
    allowCustom &&
    clean &&
    !suggestions.some((value) => value.toLowerCase() === clean.toLowerCase());
  const options = custom ? [...matches, clean] : matches;
  useEffect(() => {
    const container = list.current;
    const option = container?.children[active];
    if (container && option instanceof HTMLElement) {
      if (option.offsetTop < container.scrollTop)
        container.scrollTop = option.offsetTop;
      else if (
        option.offsetTop + option.offsetHeight >
        container.scrollTop + container.clientHeight
      )
        container.scrollTop =
          option.offsetTop + option.offsetHeight - container.clientHeight;
    }
  }, [active]);
  const choose = (value: string) => {
    onSelect(value);
    if (resetOnSelect) setText("");
    setActive(0);
  };
  return (
    <div className="se-autocomplete">
      <div className="se-autocomplete-input">
        <Search size={15} aria-hidden="true" />
        <Input
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-activedescendant={
            open && options[active] ? `${id}-${active}` : undefined
          }
          value={text}
          placeholder="Search or add a value…"
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              event.stopPropagation();
              setOpen(true);
              setActive(
                (previous) =>
                  (previous +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    options.length) %
                  Math.max(options.length, 1),
              );
            } else if (event.key === "Enter" && open && options[active]) {
              event.preventDefault();
              choose(options[active]);
            } else if (event.key === "Escape" && open) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }
          }}
        />
      </div>
      {open && (
        <div
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="se-suggestions-list"
        >
          {options.map((value, index) => {
            const checked = selected.some(
              (item) => item.toLowerCase() === value.toLowerCase(),
            );
            return (
              <button
                key={value}
                id={`${id}-${index}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={checked}
                data-active={active === index}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(value)}
              >
                {custom && index === options.length - 1 ? (
                  <>
                    <Plus size={14} />
                    Use “{value}”
                  </>
                ) : (
                  <>
                    {value}
                    {checked && <Check size={14} />}
                  </>
                )}
              </button>
            );
          })}
          {!options.length && (
            <p className="se-hint">
              {allowCustom
                ? "Type a value to add it."
                : "No supported sources match. Try another name."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
