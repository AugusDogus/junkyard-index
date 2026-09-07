"use client";

import {
  createContext,
  useContext,
  type Dispatch,
  type SetStateAction,
} from "react";

export const BuilderEdits = createContext<{
  pending: number;
  setPending: Dispatch<SetStateAction<number>>;
} | null>(null);

export function useBuilderEdits() {
  const state = useContext(BuilderEdits);
  if (!state) throw new Error("Builder edits must be inside a search editor.");
  return state;
}
