import { Fragment } from "react";

/**
 * Text whose hyphenated words ("Pull-A-Part") stay whole when a heading
 * wraps, so a line never ends in "Pull-". Lines still break at spaces.
 */
export function KeepHyphenated({ text }: { text: string }) {
  return text.split(/(\s+)/).map((part, index) =>
    part.includes("-") ? (
      <span key={index} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}
