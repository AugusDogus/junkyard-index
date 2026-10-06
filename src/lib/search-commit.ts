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

export interface PendingSearchCommit {
  value: string;
  inputValue: string;
}

export interface SearchCommitOperations {
  setPendingCommit: (commit: PendingSearchCommit) => void;
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

  params.operations.setPendingCommit({
    value: commit.value,
    inputValue: params.value,
  });
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
  pendingCommit: PendingSearchCommit | null;
  inputValue: string;
}): CommittedSearchSync {
  if (
    params.pendingCommit !== null &&
    params.committedValue !== params.pendingCommit.value
  ) {
    return { kind: "wait" };
  }

  return {
    kind: "apply",
    clearPending: params.pendingCommit !== null,
    inputValue:
      (params.pendingCommit !== null &&
        params.inputValue !== params.pendingCommit.inputValue) ||
      params.committedValue === params.inputValue.trim()
        ? null
        : params.committedValue,
  };
}
