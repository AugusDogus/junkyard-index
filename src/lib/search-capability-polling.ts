const MAX_POLLS = 6;
const INITIAL_POLL_MS = 5_000;
const MAX_POLL_MS = 60_000;

export function getSearchCapabilityPollInterval(
  ready: boolean,
  attempts: number,
): number | false {
  if (ready || attempts >= MAX_POLLS) return false;
  return Math.min(
    MAX_POLL_MS,
    INITIAL_POLL_MS * 2 ** Math.max(0, attempts - 1),
  );
}
