export interface DebugLogPayload {
  hypothesisId: string;
  location: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp?: number;
}

export function debugLogClient(payload: DebugLogPayload) {
  if (typeof window === "undefined") return;

  void fetch("/api/debug-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({
      ...payload,
      timestamp: payload.timestamp ?? Date.now(),
    }),
  }).catch(() => {
    // Ignore debug logging failures.
  });
}
