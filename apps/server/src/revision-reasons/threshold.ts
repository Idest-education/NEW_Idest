/** Share of an assignment's submissions that may go untagged before prompting. */
const PROMPT_SHARE = 0.2;
const MIN_THRESHOLD = 3;
const MAX_THRESHOLD = 15;

/**
 * How many untagged revisions trigger the batch reason prompt.
 *
 * Proportional so a big assignment is not interrupted every few essays, floored
 * so a five-student class is not prompted on its first override, and capped so
 * reasons are never collected so late that they are guesswork.
 */
export function reasonPromptThreshold(submissionCount: number): number {
  const proportional = Math.ceil(submissionCount * PROMPT_SHARE);
  return Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, proportional));
}
