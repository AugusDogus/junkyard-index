"use client";
import { createContext } from "react";
/** Keep menus inside their dialog's stacking and focus context when embedded. */
export const EditorPortal = createContext<HTMLElement | null>(null);
