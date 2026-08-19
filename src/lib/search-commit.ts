import { VinPattern } from "./vin-pattern";

export type SearchCommit =
  | { kind: "query"; value: string }
  | { kind: "vin"; value: string }
  | { kind: "invalid-vin" };

export function resolveSearchCommit(
  value: string,
  vinPatternSearchReady: boolean,
): SearchCommit {
  const trimmed = value.trim();
  if (!vinPatternSearchReady || !VinPattern.isSearchCandidate(trimmed)) {
    return { kind: "query", value: trimmed };
  }

  const parsed = VinPattern.parse(trimmed);
  if (!parsed.success || !VinPattern.toAlgoliaFilter(parsed.data)) {
    return { kind: "invalid-vin" };
  }
  return { kind: "vin", value: parsed.data.normalized };
}

export interface SearchCommitOperations {
  setPendingValue: (value: string) => void;
  changeMode: (value: {
    query: string | null;
    vinPattern: string | null;
  }) => Promise<void>;
  refine: (value: string) => void;
}

export async function executeSearchCommit(params: {
  value: string;
  vinPatternSearchReady: boolean;
  currentVinPattern: string;
  operations: SearchCommitOperations;
}): Promise<SearchCommit> {
  const commit = resolveSearchCommit(
    params.value,
    params.vinPatternSearchReady,
  );
  if (commit.kind === "invalid-vin") return commit;

  params.operations.setPendingValue(commit.value);
  if (commit.kind === "vin") {
    await params.operations.changeMode({
      query: null,
      vinPattern: commit.value,
    });
    params.operations.refine("");
    return commit;
  }

  if (params.currentVinPattern) {
    await params.operations.changeMode({
      query: commit.value || null,
      vinPattern: null,
    });
  }
  params.operations.refine(commit.value);
  return commit;
}

export type CommittedSearchSync =
  | { kind: "wait" }
  | {
      kind: "apply";
      clearPending: boolean;
      inputValue: string | null;
    };

export function resolveCommittedSearchSync(params: {
  committedValue: string;
  pendingValue: string | null;
  inputValue: string;
}): CommittedSearchSync {
  if (
    params.pendingValue !== null &&
    params.committedValue !== params.pendingValue
  ) {
    return { kind: "wait" };
  }

  return {
    kind: "apply",
    clearPending: params.committedValue === params.pendingValue,
    inputValue:
      params.committedValue === params.inputValue.trim()
        ? null
        : params.committedValue,
  };
}
