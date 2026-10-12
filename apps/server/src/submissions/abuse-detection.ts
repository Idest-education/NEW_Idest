export type AbuseReason =
  | 'too_short'
  | 'too_long'
  | 'gibberish'
  | 'not_english'
  | 'repetitive'
  | 'copied_prompt'
  | 'off_topic'
  | 'not_essay'
  | 'spam'
  | 'prompt_injection'
  | 'hidden_text';

export interface AbuseResult {
  reasons: AbuseReason[];
  details: Record<string, number | string>;
}

// The grader's own rule: 20 words or fewer is band 1, so there is nothing to grade.
const MAX_SHORT_WORD_COUNT = 20;
const MAX_ESSAY_WORD_COUNT = 1500;
// Words joined by zero-width or no spaces count as one word; characters catch that.
const MAX_ESSAY_CHARS = 15_000;

const NON_ALPHA_RATIO_SOLO_THRESHOLD = 0.6;
const NON_ALPHA_RATIO_THRESHOLD = 0.4;
const UNIQUE_WORD_RATIO_THRESHOLD = 0.25;
const UNIQUE_WORD_RATIO_SOLO_THRESHOLD = 0.05;
const UNIQUE_WORD_RATIO_MIN_WORDS = 20;
const AVG_WORD_LENGTH_THRESHOLD = 15;
const VOWEL_WORD_RATIO_THRESHOLD = 0.5;
const VOWEL_WORD_RATIO_MIN_WORDS = 15;
const CHAR_RUNS_THRESHOLD = 3;

// Language checks need enough text to be fair. Letters, not words, for scripts
// written without spaces (Chinese, Japanese, Thai).
const LANGUAGE_MIN_WORDS = 30;
const LANGUAGE_MIN_LETTERS = 100;
const NON_LATIN_LETTER_RATIO = 0.2;
const DIACRITIC_LETTER_RATIO = 0.05;
const FUNCTION_WORD_RATIO_MIN = 0.2;

const REPEAT_NGRAM = 8;
const REPEAT_RATIO = 0.3;
const PROMPT_NGRAM = 6;
const COPIED_PROMPT_RATIO = 0.5;
const OFF_TOPIC_MIN_WORDS = 80;
const OFF_TOPIC_MIN_PROMPT_STEMS = 3;

// The most frequent English words. Real English prose is roughly 40-50% these;
// another language, a keyword list or word salad is close to none.
const FUNCTION_WORDS = new Set(
  (
    'the a an and or but of to in on at for with by from as is are was were be been being it its this that ' +
    'these those there their they them he she his her we our you your i my me not no can could will would ' +
    'should may might must do does did have has had which who what when where why how if than then so such ' +
    'more most some many much also very other all both each into about because while however although one only'
  ).split(' '),
);

// Task wording every IELTS prompt shares. Off-topic is judged on the prompt's
// subject words only, never on "discuss both views and give your opinion".
const PROMPT_BOILERPLATE = new Set(
  (
    'discuss views opinion agree disagree extent reasons examples relevant include knowledge experience ' +
    'write least words give both advantages disadvantages outweigh summarise summarize information selecting ' +
    'reporting main features make comparisons where chart graph table diagram shows below above essay ' +
    'question people think believe some others many more what why should would could this these that ' +
    'there their they your with from have than which other more most such important problem problems ' +
    'solution solutions causes effects positive negative development developments happen happening ' +
    'nowadays today modern world countries country society'
  ).split(' '),
);

// Common leetspeak substitutions, reversed before matching so simple obfuscation
// ("1gn0r3 pr3v10us") doesn't slip past the phrase list below.
const LEET_MAP: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a' };

// Cyrillic and Greek letters drawn like Latin ones: "ignоre" with a Cyrillic о
// reads the same to a model and dodges a plain regex.
const HOMOGLYPHS: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ѕ: 's', ј: 'j', ԁ: 'd', ɡ: 'g', ӏ: 'l',
  α: 'a', ε: 'e', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x',
};

// Characters that render as nothing. A few stray ones come from Word or PDF copy;
// many, or any direction override or Unicode tag, are text hidden from the reader.
const INVISIBLE =
  // oxlint-disable-next-line no-misleading-character-class -- matching combining invisibles is the point
  /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;
// Soft hyphens and a byte-order mark come with PDF and Word text; stripped, never counted.
const BENIGN_INVISIBLE = new Set(['\u00AD', '\uFEFF']);
const ALWAYS_HIDDEN = /[\u202A-\u202E\u2066-\u2069\u{E0000}-\u{E007F}]/u;
const INVISIBLE_THRESHOLD = 5;

const INJECTION_PATTERNS: RegExp[] = [
  // Overriding the grader's instructions.
  /\b(ignore|disregard|forget|override|bypass)\b.{0,30}\b(previous|prior|above|earlier|preceding|foregoing|system|original)\b.{0,15}\b(instructions?|rules|directions|prompts?|guidelines|messages?|context)\b/i,
  /\b(ignore|disregard|override|bypass)\s+(all\s+)?(of\s+)?your\s+(system\s+)?(prompt|instructions|programming|rules|rubric|guidelines)\b/i,
  /disregard (the )?(system|previous) prompt/i,
  /forget (everything|all) (above|before|previous)/i,
  /\b(new|updated|real|actual|hidden|secret)\s+(system\s+)?(instructions?|prompt|task)\s*:/i,
  // Chat-template and role markers, and our own essay delimiters.
  /<\s*\/?\s*(system|assistant|user|instructions?|im_start|im_end)\b[^>]*>/i,
  /<\|[a-z_]+\|>/i,
  /\[\/?(system|inst|instructions?)\]/i,
  /###\s*(system|instruction)/i,
  /\b(begin|end)\s+(system|instructions?)\b/i,
  /<<<|>>>|\b(end_)?student_essay\b|\bfirst_reading\b|\breference_band/i,
  // Persona switches and jailbreaks.
  /you are now (an? )?(ai|assistant|examiner|grader)/i,
  /\byou are (now|no longer)\b.{0,30}\b(ai|assistant|examiner|grader|chatbot|model|gpt|gemini|claude)\b/i,
  /\b(act|behave|respond)\s+as\s+(an?\s+)?(examiner|grader|ai|assistant|system|developer)\b/i,
  /\bpretend\s+(to be|you are)\b/i,
  /\b(developer|god|jailbreak|dan)\s+mode\b/i,
  /\bdo anything now\b/i,
  // Asking for a score.
  /give (this|me) (this essay )?a (band )?9/i,
  /score this (essay )?a 9/i,
  /rate this essay perfect/i,
  /output (all )?scores as 9/i,
  /\b(give|award|assign)\s+(this|my)\s+(essay|answer|response|writing)\s+(an?\s+)?(band\s+)?(9|nine|full marks|perfect score|the (highest|maximum) (band|score))\b/i,
  /\b(give|award|assign)\s+(me|it)\s+(an?\s+)?(band\s*9|band nine|9\.0|full marks|perfect score|the (highest|maximum) (band|score))\b/i,
  /\b(score|grade|mark|rate)\s+(this|my)\s+(essay|answer|response|writing)\s+(as\s+)?(an?\s+)?(band\s*)?(9|nine|perfect)\b/i,
  /\bthis\s+(essay|answer|response)\s+(deserves|should (get|receive|be given|score))\s+(an?\s+)?(band\s*)?(9|nine|full marks|perfect)\b/i,
  /\b(all|every)\s+(criteria|criterion|scores?|bands?)\s+(should be|must be|=|as)\s*9\b/i,
  // Writing the grader's output for it.
  /"(overall|band|bands|scores?|task_response|coherence_cohesion|lexical_resource|grammatical_range_accuracy)"\s*:/i,
  /\b(task_response|coherence_cohesion|lexical_resource|grammatical_range_accuracy)\b/i,
  /\b(respond|reply|answer|output|return)\s+(only\s+)?(with|in)\s+(json|the following|this)\b/i,
  /\b(reveal|show|repeat|print|leak)\s+(me\s+)?(your|the)\s+(system\s+)?(prompt|instructions)\b/i,
  // Talking to the grader.
  /\b(note|message|instruction|reminder)\s+(to|for)\s+(the\s+)?(ai|grader|examiner|marker|model|assistant|llm|chatgpt|gpt)\b/i,
  /\bdear\s+(ai|examiner|grader|marker|chatgpt|gpt|model)\b/i,
  /\b(hey|hi|hello)\s+(ai|chatgpt|gpt|gemini|claude|grader|examiner)\b/i,
  /\bwhen (grading|scoring|marking|evaluating) this\b/i,
];

// Checked on the text with its line breaks, which the main check collapses.
const ROLE_LINE = /^\s*(system|assistant|instruction|grader|examiner)\s*:/im;

// The same attacks with letters spaced out or glued together ("i g n o r e").
const SQUASHED_INJECTION_PATTERNS: RegExp[] = [
  /ignore(all|any)?(the|your)?(previous|prior|above|earlier)(instructions|prompts?|rules)/,
  /disregard(all|any)?(the|your)?(previous|prior|above|system)(instructions|prompts?)/,
  /(give|award)(this|my|me|it)(essay)?(an?)?band(9|nine)/,
];

const CONTACT_PATTERNS: RegExp[] = [
  /\b(https?:\/\/|www\.)\S+/gi,
  // TLDs that are also English words (.me, .top, .link) are left out: "the end.Me" is a missing space.
  /\b[a-z0-9-]+\.(com|net|org|io|vn|xyz|ru|cn|biz|ly|gg)\b/gi,
  /[\w.+-]+@[\w-]+\.[a-z]{2,}/gi,
  /(?<![\w@])@[a-z0-9_]{3,}\b/gi,
  /\b(whatsapp|telegram|zalo|wechat|discord|t\.me|wa\.me)\b/gi,
];
const PHONE = /\+?\d[\d\s().-]{8,}\d/g;
const PROMO =
  /\b(buy now|order now|click (here|the link|below)|limited(-| )time offer|promo code|coupon code|free trial|sign up now|subscribe (to|now)|follow (me|us) on|dm me|inbox me|visit (our|my) (website|site|page|channel)|best price|(earn|make) money (fast|online|from home)|casino|bet now|viagra|porn|xxx)\b/gi;

const CODE_TOKENS =
  /(=>|===?|!=|&&|\|\||\+\+|::|\$\{|\bconsole\.log\b|\bdef \w+\(|\bfunction\s*\w*\s*\(|#include|\bimport\s+\w+\s+from\b|\bfrom\s+\w+\s+import\b|\bpublic static\b|\bSELECT\b.+\bFROM\b)/g;
const HTML_TAG = /<\/?[a-z][a-z0-9]*(\s[^>]*)?>/gi;
const LIST_LINE = /^\s*([-*•▪●◦]|\d+[.)]|[a-z][.)])\s+/i;
const CHAT_REQUEST =
  /\b(can|could|would|will) you\b.{0,40}\b(check|grade|mark|correct|score|rate|review|evaluate|fix)\b|\b(please|pls|plz)\b.{0,20}\b(check|grade|mark|correct|score|rate|review)\b.{0,20}\b(my|this) (essay|writing|answer)\b|\bwhat (band|score) (would|will|do|can|did) (i|my|this)\b/i;
const CHAT_MAX_WORDS = 80;

const round = (n: number, digits = 3) => Number(n.toFixed(digits));

/** NFKC folds fullwidth and math-styled letters to ASCII; then invisibles out, lookalikes mapped. */
function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(/[\u0250-\uFFFF]/g, (ch) => HOMOGLYPHS[ch] ?? ch);
}

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

/** Lowercase letter-only tokens, for language and overlap checks. */
function letterWords(text: string): string[] {
  return text.toLowerCase().match(/\p{L}+/gu) ?? [];
}

function ngrams(words: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= words.length; i++) out.push(words.slice(i, i + n).join(' '));
  return out;
}

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((sum, p) => sum + (text.match(p)?.length ?? 0), 0);
}

const stem = (w: string) => w.slice(0, 5);

/**
 * Heuristic "not worth grading" checks, run before an essay reaches the LLM.
 *
 * Tuned to favour false negatives: a missed case still meets the grader's own
 * rules and, for batches, a teacher. It never judges writing quality — a weak or
 * partly off-topic answer passes; only text with nothing gradable is stopped.
 * See docs/superpowers/specs/2026-09-20-essay-abuse-detection-design.md.
 */
export function detectAbuse(essayText: string, wordCount: number, taskPrompt?: string): AbuseResult | null {
  const reasons: AbuseReason[] = [];
  const details: Record<string, number | string> = {};

  // Hidden text, judged on the raw input before normalising removes it.
  const invisible = (essayText.match(INVISIBLE) ?? []).filter((ch) => !BENIGN_INVISIBLE.has(ch)).length;
  const mixedScript = (essayText.match(/\S+/g) ?? []).filter(
    (w) => /[a-z]/i.test(w) && /[Ͱ-ϿЀ-ӿ]/.test(w),
  ).length;
  const base64Blobs = essayText.match(/[A-Za-z0-9+/]{60,}={0,2}/g)?.length ?? 0;
  if (invisible >= INVISIBLE_THRESHOLD || ALWAYS_HIDDEN.test(essayText) || mixedScript >= 2 || base64Blobs > 0) {
    reasons.push('hidden_text');
    details.invisibleChars = invisible;
    details.mixedScriptWords = mixedScript;
    details.encodedBlobs = base64Blobs;
  }

  const text = normalize(essayText);

  if (wordCount <= MAX_SHORT_WORD_COUNT) reasons.push('too_short');
  if (wordCount > MAX_ESSAY_WORD_COUNT || text.length > MAX_ESSAY_CHARS) {
    reasons.push('too_long');
    details.chars = text.length;
  }

  const lower = text.toLowerCase();
  const words = splitWords(lower);
  const letters = letterWords(text);

  if (words.length > 0) {
    const nonSpaceChars = lower.replace(/\s/g, '');
    const nonAlphaChars = nonSpaceChars.replace(/[a-z\p{M}\u00C0-\u024F]/gu, '');
    const nonAlphaRatio = nonSpaceChars.length > 0 ? nonAlphaChars.length / nonSpaceChars.length : 0;
    details.nonAlphaRatio = round(nonAlphaRatio);

    const uniqueWordRatio = new Set(words).size / words.length;
    details.uniqueWordRatio = round(uniqueWordRatio);

    const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / words.length;
    details.avgWordLength = round(avgWordLength, 2);

    const alphaWords = words.filter((w) => /[a-z]/.test(w));
    const vowelBearingWords = alphaWords.filter((w) => /[aeiouy]/.test(w));
    const vowelWordRatio = alphaWords.length > 0 ? vowelBearingWords.length / alphaWords.length : 1;
    details.vowelWordRatio = round(vowelWordRatio);

    // "aaaaaaa", "!!!!!!", "hahahahaha"
    const charRuns = lower.match(/(.)\1{4,}|(..)\2{3,}/g)?.length ?? 0;

    let gibberishSignals = 0;
    if (nonAlphaRatio > NON_ALPHA_RATIO_THRESHOLD) gibberishSignals += 1;
    if (words.length > UNIQUE_WORD_RATIO_MIN_WORDS && uniqueWordRatio < UNIQUE_WORD_RATIO_THRESHOLD) gibberishSignals += 1;
    if (avgWordLength > AVG_WORD_LENGTH_THRESHOLD) gibberishSignals += 1;
    if (words.length > VOWEL_WORD_RATIO_MIN_WORDS && vowelWordRatio < VOWEL_WORD_RATIO_THRESHOLD) gibberishSignals += 1;
    if (charRuns >= CHAR_RUNS_THRESHOLD) gibberishSignals += 1;

    const soloExtreme =
      nonAlphaRatio > NON_ALPHA_RATIO_SOLO_THRESHOLD ||
      (words.length > UNIQUE_WORD_RATIO_MIN_WORDS && uniqueWordRatio < UNIQUE_WORD_RATIO_SOLO_THRESHOLD);
    if (gibberishSignals >= 2 || soloExtreme) {
      reasons.push('gibberish');
      details.gibberishSignals = gibberishSignals;
    }
  }

  // Another language: a non-Latin script, Latin with heavy diacritics
  // (Vietnamese), or Latin text with almost no English function words.
  const allLetters = text.match(/\p{L}/gu) ?? [];
  if (allLetters.length >= LANGUAGE_MIN_LETTERS) {
    const nonLatin = allLetters.filter((ch) => !/\p{Script=Latin}/u.test(ch)).length;
    const nonLatinRatio = nonLatin / allLetters.length;
    const marked = text.normalize('NFD').match(/\p{M}/gu)?.length ?? 0;
    const diacriticRatio = marked / allLetters.length;
    details.nonLatinRatio = round(nonLatinRatio);
    details.diacriticRatio = round(diacriticRatio);
    const functionRatio =
      letters.length >= LANGUAGE_MIN_WORDS ? letters.filter((w) => FUNCTION_WORDS.has(w)).length / letters.length : 1;
    details.functionWordRatio = round(functionRatio);
    if (
      nonLatinRatio > NON_LATIN_LETTER_RATIO ||
      diacriticRatio > DIACRITIC_LETTER_RATIO ||
      functionRatio < FUNCTION_WORD_RATIO_MIN
    ) {
      reasons.push('not_english');
    }
  }

  // Padding: the same 8-word run appearing again and again.
  const grams = ngrams(letters, REPEAT_NGRAM);
  if (grams.length >= 20) {
    const seen = new Set<string>();
    let repeats = 0;
    for (const g of grams) {
      if (seen.has(g)) repeats += 1;
      seen.add(g);
    }
    details.repeatedRatio = round(repeats / grams.length);
    if (repeats / grams.length >= REPEAT_RATIO) reasons.push('repetitive');
  }

  if (taskPrompt?.trim()) {
    const promptWords = letterWords(normalize(taskPrompt));

    const promptGrams = new Set(ngrams(promptWords, PROMPT_NGRAM));
    const essayGrams = ngrams(letters, PROMPT_NGRAM);
    if (promptGrams.size > 0 && essayGrams.length >= 5) {
      const copied = essayGrams.filter((g) => promptGrams.has(g)).length / essayGrams.length;
      details.promptOverlap = round(copied);
      if (copied >= COPIED_PROMPT_RATIO) reasons.push('copied_prompt');
    }

    // Off topic only when the essay shares not one subject word with the prompt.
    const topic = new Set(
      promptWords.filter((w) => w.length >= 4 && !FUNCTION_WORDS.has(w) && !PROMPT_BOILERPLATE.has(w)).map(stem),
    );
    if (topic.size >= OFF_TOPIC_MIN_PROMPT_STEMS && wordCount >= OFF_TOPIC_MIN_WORDS) {
      const shared = new Set(letters.filter((w) => w.length >= 4).map(stem).filter((s) => topic.has(s)));
      details.topicWordsShared = shared.size;
      if (shared.size === 0) reasons.push('off_topic');
    }
  }

  // Not an essay: code, markup, a list, or a message to the grader.
  const lines = text.split('\n').filter((l) => l.trim());
  const codeHits = text.match(CODE_TOKENS)?.length ?? 0;
  const braces = text.match(/[{}]/g)?.length ?? 0;
  const tags = text.match(HTML_TAG)?.length ?? 0;
  const listShare = lines.length >= 6 ? lines.filter((l) => LIST_LINE.test(l)).length / lines.length : 0;
  const shortLines = lines.length >= 15 && words.length / lines.length < 3;
  const chat = wordCount < CHAT_MAX_WORDS && CHAT_REQUEST.test(text);
  if (codeHits >= 3 || braces >= 4 || tags >= 3 || listShare >= 0.6 || shortLines || chat) {
    reasons.push('not_essay');
    details.notEssay = [
      codeHits >= 3 || braces >= 4 ? 'code' : '',
      tags >= 3 ? 'markup' : '',
      listShare >= 0.6 ? 'list' : '',
      shortLines ? 'short_lines' : '',
      chat ? 'message' : '',
    ]
      .filter(Boolean)
      .join(',');
  }

  const contacts =
    countMatches(text, CONTACT_PATTERNS) +
    (text.match(PHONE) ?? []).filter((m) => m.replace(/\D/g, '').length >= 10).length;
  const promo = text.match(PROMO)?.length ?? 0;
  if (contacts >= 2 || promo >= 2 || (contacts >= 1 && promo >= 1)) {
    reasons.push('spam');
    details.contacts = contacts;
    details.promoPhrases = promo;
  }

  const normalized = normalizeForInjectionCheck(text);
  const squashed = normalized.replace(/[^a-z0-9]/g, '');
  const matchedPatterns = [
    ...INJECTION_PATTERNS.map((p) => p.exec(normalized)?.[0]),
    ...SQUASHED_INJECTION_PATTERNS.map((p) => p.exec(squashed)?.[0]),
    ROLE_LINE.exec(text)?.[0],
  ].filter((m): m is string => Boolean(m));
  if (matchedPatterns.length > 0) {
    reasons.push('prompt_injection');
    details.matchedPatterns = matchedPatterns.join(' | ');
  }

  if (reasons.length === 0) return null;
  return { reasons, details };
}
