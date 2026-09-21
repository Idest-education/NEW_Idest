export type AbuseReason = 'too_short' | 'too_long' | 'gibberish' | 'prompt_injection';

export interface AbuseResult {
  reasons: AbuseReason[];
  details: Record<string, number | string>;
}

const MIN_ESSAY_WORD_COUNT = 10;
const MAX_ESSAY_WORD_COUNT = 1500;

const NON_ALPHA_RATIO_SOLO_THRESHOLD = 0.6;
const NON_ALPHA_RATIO_THRESHOLD = 0.4;
const UNIQUE_WORD_RATIO_THRESHOLD = 0.25;
const UNIQUE_WORD_RATIO_SOLO_THRESHOLD = 0.05;
const UNIQUE_WORD_RATIO_MIN_WORDS = 20;
const AVG_WORD_LENGTH_THRESHOLD = 15;
const VOWEL_WORD_RATIO_THRESHOLD = 0.5;
const VOWEL_WORD_RATIO_MIN_WORDS = 15;

// Common leetspeak substitutions, reversed before matching so simple obfuscation
// ("1gn0r3 pr3v10us") doesn't slip past the phrase list below.
const LEET_MAP: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a' };

const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |any )?(previous|prior|above) instructions/i,
  /disregard (the )?(system|previous) prompt/i,
  /forget everything above/i,
  /<\s*\/?\s*system[^>]*>/i,
  /\[system\]/i,
  /###\s*system/i,
  /you are now (an? )?(ai|assistant|examiner|grader)/i,
  /give (this|me) (this essay )?a (band )?9/i,
  /score this (essay )?a 9/i,
  /rate this essay perfect/i,
  /output (all )?scores as 9/i,
  /note to (ai|grader|examiner)/i,
  /dear (ai|examiner)/i,
  /when grading this,/i,
];

function normalizeForInjectionCheck(text: string): string {
  const leetReversed = text
    .toLowerCase()
    .split('')
    .map((ch) => LEET_MAP[ch] ?? ch)
    .join('');
  return leetReversed.replace(/\s+/g, ' ');
}

function splitWords(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/**
 * Heuristic-only, structural checks. Never judges grammar, coherence, topical
 * relevance, or writing quality — an essay can be badly written or off-topic
 * and still pass cleanly; that judgment stays with the AI scorer / teacher.
 * See docs/superpowers/specs/2026-09-20-essay-abuse-detection-design.md.
 */
export function detectAbuse(essayText: string, wordCount: number): AbuseResult | null {
  const reasons: AbuseReason[] = [];
  const details: Record<string, number | string> = {};

  if (wordCount < MIN_ESSAY_WORD_COUNT) {
    reasons.push('too_short');
  }
  if (wordCount > MAX_ESSAY_WORD_COUNT) {
    reasons.push('too_long');
  }

  const lower = essayText.toLowerCase();
  const words = splitWords(lower);

  if (words.length > 0) {
    const nonSpaceChars = lower.replace(/\s/g, '');
    const nonAlphaChars = nonSpaceChars.replace(/[a-z]/g, '');
    const nonAlphaRatio = nonSpaceChars.length > 0 ? nonAlphaChars.length / nonSpaceChars.length : 0;
    details.nonAlphaRatio = Number(nonAlphaRatio.toFixed(3));

    const uniqueWordRatio = new Set(words).size / words.length;
    details.uniqueWordRatio = Number(uniqueWordRatio.toFixed(3));

    const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / words.length;
    details.avgWordLength = Number(avgWordLength.toFixed(2));

    const alphaWords = words.filter((w) => /[a-z]/.test(w));
    const vowelBearingWords = alphaWords.filter((w) => /[aeiou]/.test(w));
    const vowelWordRatio = alphaWords.length > 0 ? vowelBearingWords.length / alphaWords.length : 1;
    details.vowelWordRatio = Number(vowelWordRatio.toFixed(3));

    let gibberishSignals = 0;
    if (nonAlphaRatio > NON_ALPHA_RATIO_THRESHOLD) gibberishSignals += 1;
    if (words.length > UNIQUE_WORD_RATIO_MIN_WORDS && uniqueWordRatio < UNIQUE_WORD_RATIO_THRESHOLD) gibberishSignals += 1;
    if (avgWordLength > AVG_WORD_LENGTH_THRESHOLD) gibberishSignals += 1;
    if (words.length > VOWEL_WORD_RATIO_MIN_WORDS && vowelWordRatio < VOWEL_WORD_RATIO_THRESHOLD) gibberishSignals += 1;

    const soloExtreme =
      nonAlphaRatio > NON_ALPHA_RATIO_SOLO_THRESHOLD ||
      (words.length > UNIQUE_WORD_RATIO_MIN_WORDS && uniqueWordRatio < UNIQUE_WORD_RATIO_SOLO_THRESHOLD);
    const gibberish = gibberishSignals >= 2 || soloExtreme;
    if (gibberish) {
      reasons.push('gibberish');
      details.gibberishSignals = gibberishSignals;
    }
  }

  const normalized = normalizeForInjectionCheck(essayText);
  const matchedPatterns = INJECTION_PATTERNS.map((p) => p.exec(normalized)?.[0]).filter(
    (m): m is string => Boolean(m),
  );
  if (matchedPatterns.length > 0) {
    reasons.push('prompt_injection');
    details.matchedPatterns = matchedPatterns.join(' | ');
  }

  if (reasons.length === 0) return null;
  return { reasons, details };
}
