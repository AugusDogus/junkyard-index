"use client";

import { X } from "lucide-react";
import { useCallback } from "react";

export function StatusBannerDismissButton({
  bannerId,
  dismissKey,
}: {
  bannerId: string;
  dismissKey: string;
}) {
  const handleDismiss = useCallback(() => {
    try {
      sessionStorage.setItem(dismissKey, "1");
    } catch {
      // sessionStorage unavailable
    }
    const el = document.getElementById(bannerId);
    if (el) el.setAttribute("hidden", "");
  }, [bannerId, dismissKey]);

  return (
    <button
      type="button"
      onClick={handleDismiss}
      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 opacity-60 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
      aria-label="Dismiss status banner"
    >
      <X className="size-3.5" />
    </button>
  );
}
