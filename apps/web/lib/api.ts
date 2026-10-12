// Typed client for the AIO server API. Every call goes through `request`, which
// attaches the Clerk session token and turns error bodies into an ApiError.

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export type TaskType = "task_1" | "task_2";
export type Role = "student" | "teacher" | "admin";
export type SubmissionStatus =
  | "submitted"
  | "queued"
  | "scoring"
  | "scored"
  | "under_review"
  | "published"
  | "failed"
  | "abuse";
export type IntakeStatus = "pending" | "extracting" | "extracted" | "failed";

export const CRITERIA = [
  { key: "task_response", short: "TR", name: "Task Response" },
  { key: "coherence_cohesion", short: "CC", name: "Coherence & Cohesion" },
  { key: "lexical_resource", short: "LR", name: "Lexical Resource" },
  { key: "grammatical_range_accuracy", short: "GRA", name: "Grammatical Range & Accuracy" },
] as const;
export type CriterionKey = (typeof CRITERIA)[number]["key"];
export type Scores = Record<CriterionKey | "overall", number>;

export interface SentenceFeedback {
  category: string;
  original: string;
  /** What's wrong. */
  explanation: string;
  /** The rewrite. */
  suggestion: string;
}
export interface CriterionFeedback {
  comment: string;
  /** Quotes and reasoning behind the band. Only sent to signed-in viewers. */
  evidence?: string[];
  reasoning?: string;
}
export interface Feedback {
  comment?: string;
  criteria?: Partial<Record<CriterionKey, CriterionFeedback>>;
  sentence_feedback?: SentenceFeedback[];
  /** Results from before per-criterion comments; still stored, still shown. */
  summary?: string;
  strengths?: string[];
  improvements?: string[];
}

/** Task 1 scores Task Achievement under the same key Task 2 uses for Task Response. */
export const criterionName = (c: (typeof CRITERIA)[number], taskType: TaskType) =>
  c.key === "task_response" && taskType === "task_1" ? { short: "TA", name: "Task Achievement" } : c;

/** Label for a sentence comment's category: a criterion key now, free text in older results. */
export function categoryLabel(category: string, taskType: TaskType): { short: string; name: string } {
  const c = CRITERIA.find((x) => x.key === category);
  if (c) return criterionName(c, taskType);
  const name = category.replace(/_/g, " ");
  return { short: name, name };
}

export interface GradingResult {
  id: string;
  status: SubmissionStatus;
  taskType: TaskType;
  taskPrompt: string;
  taskImageUrl: string | null;
  essayText: string;
  wordCount: number;
  submittedAt: string;
  result: { by: "ai" | "teacher"; scores: Scores; feedback: Feedback } | null;
}
export interface Quota {
  /** Gradings left in the tighter window. */
  remaining: number;
  limit: number;
  window: "day" | "hour";
}
export interface ChatTurn {
  id: string;
  question: string;
  answer: string | null;
  status: "pending" | "answered" | "failed";
  createdAt: string;
}
export interface ChatThread {
  turns: ChatTurn[];
  limit: number;
  remaining: number;
}
export interface Transcription {
  id: string;
  status: IntakeStatus;
  text: string | null;
  taskPrompt: string | null;
  failed: boolean;
}
export interface Page<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
export interface MyGrading {
  id: string;
  status: SubmissionStatus;
  taskType: TaskType;
  taskPrompt: string;
  wordCount: number;
  submittedAt: string;
  aiScores: Scores | null;
}

export interface Batch {
  id: string;
  teacherId: string;
  name: string;
  taskType: TaskType;
  taskPrompt: string;
  taskImageUrl: string | null;
  createdAt: string;
}
export interface BatchSummary extends Batch {
  fileCount: number;
  essayCount: number;
  counts: Partial<Record<SubmissionStatus, number>>;
}
export interface BatchFile {
  id: string;
  fileName: string;
  kind: string;
  status: IntakeStatus;
  error: string | null;
  sizeBytes: number;
  createdAt: string;
}
export interface BatchItem {
  id: string;
  status: SubmissionStatus;
  wordCount: number;
  taskType: TaskType;
  sourceFileId: string | null;
  submittedAt: string;
  studentLabel: string | null;
  aiScores: Scores | null;
  finalScores: Scores | null;
}
export interface BatchDetail extends Batch {
  files: BatchFile[];
  items: BatchItem[];
}

export interface ScoringResult {
  id: string;
  scorerType: "ai" | "teacher";
  status: string;
  scores: Scores;
  feedback: Feedback;
  createdAt: string;
}
export interface ScoreRevision {
  id: string;
  baseResultId: string | null;
  revisionNumber: number;
  changes: { score_changes?: { criterion: string; from: number; to: number }[] } | null;
  finalScores: Scores;
  finalFeedback: Feedback;
  revisionNote: string | null;
  createdAt: string;
}
export interface PublishedResult {
  id: string;
  revisionId: string;
  finalScores: Scores;
  finalFeedback: Feedback;
  publishedAt: string;
  unpublishedAt: string | null;
}
export interface Submission {
  id: string;
  source: "assignment" | "public" | "batch";
  batchId: string | null;
  taskType: TaskType;
  taskPrompt: string;
  taskImageUrl: string | null;
  essayText: string;
  wordCount: number;
  status: SubmissionStatus;
  abuseReason: string | null;
  sourceRef: { studentLabel?: string | null } | null;
  submittedAt: string;
  scoringResults: ScoringResult[];
  scoreRevisions: ScoreRevision[];
  publishedResults: PublishedResult[];
}
export interface TimelineEntry {
  timestamp: string;
  type: "ai_scoring" | "teacher_revision" | "published_superseded" | "published_active";
  actor: string | null;
}
export interface History {
  timeline: TimelineEntry[];
}
export interface RevisionInput {
  baseResultId?: string;
  finalScores: Scores;
  finalFeedback: Feedback;
  revisionNote?: string;
}
export interface UntaggedRevision {
  id: string;
  revisionNumber: number;
  changes: ScoreRevision["changes"];
  revisionNote: string | null;
  createdAt: string;
  submission: { id: string; sourceRef: { studentLabel?: string | null } | null };
}
export const REASON_CODES = [
  { code: "ai_too_generous", label: "AI was too generous" },
  { code: "ai_too_harsh", label: "AI was too harsh" },
  { code: "ai_missed_off_topic", label: "AI missed that it was off-topic" },
  { code: "ai_wrong_criterion", label: "AI scored the wrong criterion" },
  { code: "ai_feedback_inaccurate", label: "AI feedback was wrong" },
  { code: "ai_unavailable", label: "AI result was missing" },
  { code: "minor_polish", label: "Small polish" },
  { code: "other", label: "Other" },
] as const;
export type ReasonCode = (typeof REASON_CODES)[number]["code"];

export interface Profile {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: string;
  createdAt: string;
}
export interface Ticket {
  id: string;
  subject: string;
  message: string;
  status: string;
  statusType: string | null;
  createdAt: string;
  /** Screenshots attached to the ticket (images only). */
  attachments?: { id: string; title?: string; url: string; thumbnailUrl?: string }[];
}
export interface AnalyticsOverview {
  totals: { submissionsWithRevision: number; publishedCount: number };
  agreement: {
    rowsWithAiBaseline: number;
    overrideCount: number;
    overrideRate: number | null;
    meanAbsDelta: Record<CriterionKey | "overall", number | null>;
  };
  scoring: {
    attempts: number;
    completions: number;
    failures: number;
    retries: number;
    failureRate: number | null;
    meanQueueLatencySeconds: number | null;
    meanScoringLatencySeconds: number | null;
  };
  process: { meanReviewDurationSeconds: number | null; reasonTaggedRate: number | null };
}
export interface ScoringHealthRow {
  day: string;
  modelName: string;
  modelVersion: string;
  attempts: number;
  completions: number;
  failures: number;
  retries: number;
  meanQueueLatencySeconds: number | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly body: unknown,
  ) {
    super(errorMessage(status, code, body));
    this.name = "ApiError";
  }
}

const COPY: Record<string, string> = {
  daily_limit_reached:
    "You've reached today's grading limit. Come back tomorrow, or sign in as a teacher for a higher limit.",
  hourly_limit_reached: "You've graded a lot this hour. Take a short break, then try again.",
  essay_rejected: "We detected abuse. Please be a nice person: your device and IP address have been flagged.",
  unsupported_image_type: "That image type isn't supported. Use a JPG, PNG, WebP, GIF or HEIC photo.",
  invalid_transcription: "Those photos can't be used any more. Upload them again.",
  queue_unavailable: "Grading is busy right now. Your essay is saved, so try again in a minute.",
  not_retryable: "This one is already being scored. Give it a moment.",
  not_found: "We couldn't find that. The link may be wrong.",
  captcha_failed: "We couldn't confirm you're human. Reload the page, then try again.",
  captcha_unavailable: "Our security check is unavailable right now. Try again in a minute, or sign in.",
  no_images: "Add at least one photo.",
  chat_limit_reached: "You've used all your questions for this essay.",
  chat_busy: "Io is still answering your last question.",
  chat_unavailable: "Io can't answer right now. Try again in a minute.",
  not_graded: "Wait for the grade, then ask.",
  not_owner: "Only the person who graded this essay can ask about it.",
  no_files: "Add at least one file.",
  unsupported_file_type: "Some files aren't supported. Use images, PDF, Word (.doc, .docx) or Excel (.xls, .xlsx, .csv).",
  too_many_files: "A batch holds up to 30 files. Remove a few, then try again.",
};

/** Why an essay was not worth grading, one line per server reason code. */
export const ABUSE_COPY: Record<string, string> = {
  too_short: "It's 20 words or fewer.",
  too_long: "It's over 1,500 words.",
  gibberish: "Parts of it don't look like real words.",
  not_english: "It doesn't read as English.",
  repetitive: "The same passage repeats to fill space.",
  copied_prompt: "Most of it is the task prompt copied back.",
  off_topic: "It doesn't mention anything from the task prompt.",
  not_essay: "It looks like code, a list or a message, not an essay.",
  spam: "It contains links, contact details or advertising.",
  prompt_injection: "It contains instructions aimed at the grader.",
  hidden_text: "It contains hidden characters or encoded text.",
};

function errorMessage(status: number, code: string | null, body: unknown): string {
  if (code && COPY[code]) return COPY[code];
  if (status === 429) return "That's a lot of requests at once. Wait a minute, then try again.";
  if (status === 401) return "Your session ended. Sign in again to continue.";
  if (status === 403) return "This account doesn't have access to that.";
  if (status === 0) return "We can't reach AIO right now. Check your connection, then try again.";
  const message = (body as { message?: unknown } | null)?.message;
  if (status === 400 && typeof message === "string") return message;
  if (status === 400 && Array.isArray(message)) return String(message[0]);
  return "Something went wrong on our side. Try again in a moment.";
}

/** Friendly copy for anything a call can throw. */
export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Try again.";
}

type GetToken = () => Promise<string | null>;
type Body = { json?: unknown; form?: FormData; captcha?: string };

export function createApi(getToken: GetToken, base = API_URL, fetcher: typeof fetch = fetch) {
  async function send(method: string, path: string, body: Body = {}): Promise<Response> {
    const headers: Record<string, string> = {};
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body.captcha) headers["CF-Turnstile-Response"] = body.captcha;
    let payload: BodyInit | undefined = body.form;
    if (body.json !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body.json);
    }
    let res: Response;
    try {
      res = await fetcher(`${base}${path}`, { method, headers, body: payload });
    } catch {
      throw new ApiError(0, null, null);
    }
    if (!res.ok) {
      const data: unknown = await res.json().catch(() => null);
      const code = (data as { error?: unknown } | null)?.error;
      // Nest's own errors use `error` for the HTTP reason phrase ("Bad Request"), not a code.
      const isCode = typeof code === "string" && /^[a-z_]+$/.test(code);
      throw new ApiError(res.status, isCode ? code : null, data);
    }
    return res;
  }

  async function call<T>(method: string, path: string, body?: Body): Promise<T> {
    const res = await send(method, path, body);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  async function download(path: string, fallbackName: string): Promise<{ blob: Blob; fileName: string }> {
    const res = await send("GET", path);
    const header = res.headers.get("Content-Disposition") ?? "";
    const encoded = /filename\*=UTF-8''([^;]+)/.exec(header)?.[1];
    const plain = /filename="([^"]+)"/.exec(header)?.[1];
    return { blob: await res.blob(), fileName: encoded ? decodeURIComponent(encoded) : (plain ?? fallbackName) };
  }

  const form = (fields: Record<string, string | Blob | Blob[] | undefined>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
    }
    return data;
  };

  return {
    grade: (input: {
      taskType: TaskType;
      taskPrompt: string;
      essayText: string;
      idempotencyKey: string;
      transcriptionId?: string;
      taskImage?: File;
    }, captcha?: string) =>
      call<{ id: string; status: SubmissionStatus }>("POST", "/grade", {
        form: form({ ...input }),
        captcha,
      }),
    transcribe: (images: File[], captcha?: string) =>
      call<{ id: string; status: IntakeStatus }>("POST", "/grade/transcribe", { form: form({ images }), captcha }),
    transcription: (id: string) => call<Transcription>("GET", `/grade/transcribe/${id}`),
    result: (id: string) => call<GradingResult>("GET", `/grade/${id}`),
    retryGrading: (id: string) => call<{ id: string; status: SubmissionStatus }>("POST", `/grade/${id}/retry`),
    quota: () => call<Quota>("GET", "/grade/quota"),
    chat: (id: string) => call<ChatThread>("GET", `/grade/${id}/chat`),
    ask: (id: string, question: string) => call<ChatTurn>("POST", `/grade/${id}/chat`, { json: { question } }),
    mine: (page = 1, limit = 50) => call<Page<MyGrading>>("GET", `/grade/mine?page=${page}&limit=${limit}`),

    batches: () => call<BatchSummary[]>("GET", "/batches"),
    batch: (id: string) => call<BatchDetail>("GET", `/batches/${id}`),
    createBatch: (input: { name: string; taskType: TaskType; taskPrompt: string; taskImage?: File }) =>
      call<Batch>("POST", "/batches", { form: form({ ...input }) }),
    addFiles: (id: string, files: File[]) =>
      call<Pick<BatchFile, "id" | "fileName" | "kind" | "status">[]>("POST", `/batches/${id}/files`, {
        form: form({ files }),
      }),
    retryBatch: (id: string) => call<{ files: number; essays: number }>("POST", `/batches/${id}/retry`),
    exportBatch: (id: string) => download(`/batches/${id}/export`, "scores.xlsx"),
    untagged: (batchId: string) => call<UntaggedRevision[]>("GET", `/batches/${batchId}/revisions/untagged`),
    tagRevisions: (input: { revisionIds: string[]; reasonCodes: ReasonCode[]; note?: string }) =>
      call<unknown>("POST", "/revision-reasons/batch", { json: input }),

    submission: (id: string) => call<Submission>("GET", `/submissions/${id}`),
    history: (id: string) => call<History>("GET", `/submissions/${id}/history`),
    saveRevision: (id: string, input: RevisionInput) =>
      call<ScoreRevision>("POST", `/submissions/${id}/revisions`, { json: input }),
    publish: (id: string, revisionId: string) =>
      call<PublishedResult>("POST", `/submissions/${id}/publish`, { json: { revisionId } }),
    unpublish: (id: string, reason?: string) =>
      call<unknown>("POST", `/submissions/${id}/unpublish`, { json: reason ? { reason } : {} }),
    retryScoring: (id: string) => call<unknown>("POST", `/submissions/${id}/retry-scoring`),
    abuseReview: (id: string, decision: "confirm" | "reject", action?: "requeue" | "manual") =>
      call<unknown>("POST", `/submissions/${id}/abuse-review`, { json: action ? { decision, action } : { decision } }),
    reviewSession: (id: string) => call<unknown>("POST", `/submissions/${id}/review-session`),

    me: () => call<Profile>("GET", "/users/me"),
    updateMe: (displayName: string) => call<Profile>("PATCH", "/users/me", { json: { displayName } }),
    deleteMe: (confirmEmail: string) => call<{ message: string }>("DELETE", "/users/me", { json: { confirmEmail } }),
    tickets: () => call<Ticket[]>("GET", "/support/tickets"),
    createTicket: (input: { subject: string; message: string; images?: File[] }) =>
      call<Ticket>("POST", "/support/tickets", { form: form({ ...input }) }),

    overview: () => call<AnalyticsOverview>("GET", "/analytics/overview"),
    scoringHealth: () => call<ScoringHealthRow[]>("GET", "/analytics/scoring-health"),
    exportAnalytics: (format: "csv" | "jsonl") =>
      download(`/analytics/export?format=${format}`, `assessment-outcomes.${format}`),
  };
}

export type Api = ReturnType<typeof createApi>;
