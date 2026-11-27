import { z } from "zod";

const SUMMARY_MAX = 160;

const messagesSchema = z.array(z.string());
const taggedErrorSchema = z.object({ message: z.string() });

// `<source> ingestion failed: Step "..." failed after N retries: ` and
// `Vehicle source chunk <source> failed: ` wrap most source failures. Chunk
// failures stored before Nov 27, 2026 put the cursor JSON before the cause
// (`Vehicle source chunk <source>/{...} failed: `); newer ones put a bounded
// `\nCursor: {...}` after it.
const STEP_WRAPPER = /^.*?Step "[^"]*" failed after \d+ retries: /s;
const CHUNK_WRAPPER = /^Vehicle source chunk [^/\s]+(?:\/\{.*?\})? failed: /s;
const CHUNK_CURSOR = /\nCursor: \{.*$/s;
// An old chunk wrapper whose cause was cut off: only its cursor JSON remains.
const UNCLOSED_CHUNK_WRAPPER = /^Vehicle source chunk [^/]+\/\{/;
const UNCLOSED_CHUNK_MESSAGE =
  "A step of the run failed. The cause is in the full error text.";
// The first string of a JSON array cut off part way, as SQL excerpts are.
const CUT_OFF_FIRST_STRING = /^\["((?:[^"\\]|\\.)*)/s;
// The message of a tagged error object cut off part way.
const CUT_OFF_TAGGED_MESSAGE = /^\{"tag":.*?"message":"((?:[^"\\]|\\.)*)/s;

const RULES: readonly {
  pattern: RegExp;
  summary: (match: RegExpMatchArray) => string;
}[] = [
  {
    pattern: /produced 0 unique vehicles; minimum is (\d+)/i,
    summary: (match) =>
      `The run found no vehicles, fewer than the ${Number(match[1]).toLocaleString("en-US")} expected.`,
  },
  {
    pattern: /inventory fell from (\d+) to (\d+)/i,
    summary: (match) =>
      `The vehicle count fell from ${Number(match[1]).toLocaleString("en-US")} to ${Number(match[2]).toLocaleString("en-US")}, too big a drop to trust.`,
  },
  {
    pattern: /timed out|timeout|deadline exceeded/i,
    summary: () => "The yard's website was too slow to answer in time.",
  },
  {
    pattern: /\b(403|429)\b|blocked|captcha|rate.?limit/i,
    summary: () => "The yard's website blocked or limited our requests.",
  },
  {
    pattern: /changed|disagree|does not reconcile|did not recover/i,
    summary: () =>
      "The yard's website did not look the way our checks expect. It may have changed.",
  },
];

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The JSON string literal a pattern captures, decoded, if it matches. */
function cutOffString(raw: string, pattern: RegExp): string | undefined {
  const escaped = pattern.exec(raw)?.[1];
  if (escaped === undefined) return undefined;
  const decoded = parseJson(`"${escaped}"`);
  return typeof decoded === "string" ? decoded : undefined;
}

function firstSentence(text: string): string {
  const sentence = /^.*?[.!?](?=\s|$)/s.exec(text)?.[0] ?? text;
  return sentence.length <= SUMMARY_MAX
    ? sentence
    : `${sentence.slice(0, SUMMARY_MAX - 3)}...`;
}

/**
 * Error text stored by ingestion runs (a JSON array of strings), read for
 * the admin dashboard: the raw messages, and one plain sentence for an owner
 * who does not read stack traces.
 */
export const ErrorText = {
  /**
   * The stored messages. An array cut off part way (an excerpt) yields its
   * first message as far as it goes; other text is one message.
   */
  messages(raw: string | null): string[] {
    if (raw === null || raw.trim() === "") return [];
    const parsed = messagesSchema.safeParse(parseJson(raw));
    if (parsed.success) return parsed.data;
    const first = cutOffString(raw, CUT_OFF_FIRST_STRING);
    return [first ?? raw];
  },

  /** A message without the workflow wrappers around its cause. */
  core(message: string): string {
    const unwrapped = message
      .replace(STEP_WRAPPER, "")
      .replace(CHUNK_WRAPPER, "")
      .replace(CHUNK_CURSOR, "");
    if (UNCLOSED_CHUNK_WRAPPER.test(unwrapped)) return UNCLOSED_CHUNK_MESSAGE;
    const tagged = taggedErrorSchema.safeParse(parseJson(unwrapped));
    if (tagged.success) return tagged.data.message;
    return cutOffString(unwrapped, CUT_OFF_TAGGED_MESSAGE) ?? unwrapped;
  },

  /**
   * One plain sentence for the messages: a known failure in everyday words,
   * otherwise the first sentence of the first message. Null without any.
   */
  summary(messages: readonly string[]): string | null {
    const cores = messages.map(ErrorText.core);
    for (const rule of RULES) {
      for (const core of cores) {
        const match = core.match(rule.pattern);
        if (match) return rule.summary(match);
      }
    }
    const first = cores[0];
    return first === undefined ? null : firstSentence(first.trim());
  },
} as const;
