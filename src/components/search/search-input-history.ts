/**
 * How search URL writes enter browser history while someone types. Typing
 * replaces the current entry. A submit adds one entry for the final search,
 * and Back returns to the search from before typing began.
 */
export type SearchHistoryWrite =
  | { history: "replace" }
  | { history: "push" }
  /**
   * Put `previous` back in the current entry just before pushing: live
   * previews replaced it while typing.
   */
  | { history: "push"; previous: string };

// One draft per browser window, shared by the input and the URL writer.
type Draft =
  | { kind: "typing"; previous: string }
  | { kind: "submitting"; previous: string };
const drafts = new WeakMap<Window, Draft>();

function checkpoint(previous: string, unchanged: boolean): SearchHistoryWrite {
  return unchanged ? { history: "replace" } : { history: "push", previous };
}

export const SearchInputHistory = {
  /** Typing started; live previews replace this entry. */
  begin() {
    if (!drafts.has(window))
      drafts.set(window, {
        kind: "typing",
        previous: window.location.href,
      });
  },
  cancel() {
    drafts.delete(window);
  },
  /** The next search write is a submitted search. */
  submit() {
    drafts.set(window, {
      kind: "submitting",
      previous: drafts.get(window)?.previous ?? window.location.href,
    });
  },
  /**
   * A submit of the search a live preview already wrote: the write that
   * checkpoints it, or null when nothing was typed. `isWritten` says whether
   * a URL is the search being written.
   */
  submitShown(isWritten: (href: string) => boolean): SearchHistoryWrite | null {
    const draft = drafts.get(window);
    drafts.delete(window);
    return draft ? checkpoint(draft.previous, isWritten(draft.previous)) : null;
  },
  /**
   * The history mode for a write that changes the search URL. A change of
   * query alone is typing. A change that keeps the same results (such as a
   * canonical rewrite of a URL a saved search pushed) adds no entry.
   */
  write(change: {
    onlyQuery: boolean;
    sameResults: boolean;
    isWritten: (href: string) => boolean;
  }): SearchHistoryWrite {
    const draft = drafts.get(window);
    if (draft?.kind === "submitting") {
      drafts.delete(window);
      return checkpoint(draft.previous, change.isWritten(draft.previous));
    }
    if ((draft?.kind === "typing" && change.onlyQuery) || change.sameResults)
      return { history: "replace" };
    drafts.delete(window);
    return { history: "push" };
  },
} as const;
