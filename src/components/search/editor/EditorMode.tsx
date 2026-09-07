"use client";
import { useState } from "react";
import { hasAdvancedSearchSyntax } from "~/lib/advanced-search-query";
export function useEditorMode(query: string) {
  const [mode, changeMode] = useState<"basic" | "advanced">(
    hasAdvancedSearchSyntax(query) ? "advanced" : "basic",
  );
  return { mode, changeMode };
}
