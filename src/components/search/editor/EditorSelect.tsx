"use client";
import { useId, useContext, type ReactNode } from "react";
import { EditorPortal } from "./EditorPortal";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
} from "~/components/ui/select";
export function EditorSelect({
  value,
  onValueChange,
  children,
  disabled,
  "aria-label": label,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const id = useId();
  const container = useContext(EditorPortal);
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={label} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent container={container}>
        <SelectGroup>{children}</SelectGroup>
      </SelectContent>
    </Select>
  );
}
