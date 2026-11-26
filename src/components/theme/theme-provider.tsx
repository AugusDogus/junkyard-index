"use client";

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import * as React from "react";

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}

/**
 * Sets the theme with transitions held off for that one change, so colors
 * switch at once. next-themes' `disableTransitionOnChange` does the same,
 * but on every page load too, where it costs two full-page style passes.
 */
export function useThemeSwitch(): (theme: string) => void {
  const { setTheme } = useTheme();
  return React.useCallback(
    (theme: string) => {
      const style = document.createElement("style");
      style.textContent = "*,*::before,*::after{transition:none!important}";
      document.head.append(style);
      setTheme(theme);
      // next-themes applies the theme in an effect, before the next frame.
      window.requestAnimationFrame(() => {
        getComputedStyle(document.body).getPropertyValue("color");
        style.remove();
      });
    },
    [setTheme],
  );
}
