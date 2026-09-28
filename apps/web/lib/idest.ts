import type { Role, UserStatus } from "@repo/auth-contract";
import type { RevisionReason, ScoreChange } from "./reason-codes";
import { apiFetch } from "./api";

export type TaskType = "task_1" | "task_2";
export type AssignmentStatus = "draft" | "active" | "closed" | "archived";
export type SubmissionStatus =
  | "submitted"
  | "queued"
  | "scoring"
  | "scored"
  | "under_review"
  | "published"
  | "failed"
  | "abuse";
export type ScorerType = "ai" | "teacher";
export type ClassStatus = "active" | "archived";
export type RedoRequestStatus = "open" | "resolved" | "cancelled";
export type Criterion =
  | "task_response"
  | "coherence_cohesion"
  | "lexical_resource"
  | "grammatical_range_accuracy";

export const CRITERIA: Criterion[] = [
  "task_response",
  "coherence_cohesion",
  "lexical_resource",
  "grammatical_range_accuracy",
];

export const CRITERION_LABEL: Record<Criterion, string> = {
  task_response: "Task Response",
  coherence_cohesion: "Coherence & Cohesion",
  lexical_resource: "Lexical Resource",
  grammatical_range_accuracy: "Grammatical Range & Accuracy",
};

export const CRITERION_ABBR: Record<Criterion, string> = {
  task_response: "TR",
  coherence_cohesion: "CC",
  lexical_resource: "LR",
  grammatical_range_accuracy: "GRA",
};

/** Bay a submission is seated in, from the teacher's side of the board. */
export const BAY_LABEL: Record<SubmissionStatus, string> = {
  submitted: "Chờ vào hàng",
  queued: "Chờ AI chấm",
  scoring: "AI đang chấm",
  scored: "Chờ giáo viên",
  under_review: "Đang sửa",
  published: "Đã duyệt",
  failed: "AI tạm thời bảo trì",
  abuse: "Nghi ngờ vi phạm",
};

/**
 * What the student is told. Internal pipeline states never reach them —
 * 'abuse' reads identically to a normal pending submission on purpose, so a
 * flagged essay is indistinguishable from one waiting for review.
 */
export const STUDENT_STATE_LABEL: Record<SubmissionStatus, string> = {
  submitted: "Đã nộp",
  queued: "Đã nộp",
  scoring: "Đã nộp",
  scored: "Giáo viên đang chấm",
  under_review: "Giáo viên đang chấm",
  published: "Đã có kết quả",
  failed: "Đang chờ xử lý",
  abuse: "Đã nộp",
};

export const ASSIGNMENT_STATUS_LABEL: Record<AssignmentStatus, string> = {
  draft: "Bản nháp",
  active: "Đang mở",
  closed: "Đã đóng",
  archived: "Lưu trữ",
};

export const CLASS_STATUS_LABEL: Record<ClassStatus, string> = {
  active: "Đang hoạt động",
  archived: "Lưu trữ",
};

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  task_1: "Task 1",
  task_2: "Task 2",
};

export type Scores = Partial<Record<Criterion, number>> & { overall?: number };

export interface SentenceMark {
  sentence_index: number;
  category: string;
  original: string;
  suggestion: string;
  explanation: string;
}

export interface Feedback {
  summary?: string;
  strengths?: string[];
  improvements?: string[];
  sentence_feedback?: SentenceMark[];
}

export interface Person {
  id: string;
  displayName: string;
  email: string;
}

export interface Profile {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  createdAt: string;
}

export interface ClassRef {
  id: string;
  name: string;
  memberCount?: number | null;
}

export interface Assignment {
  id: string;
  teacherId: string;
  classId: string | null;
  class?: ClassRef | null;
  title: string;
  taskPrompt: string;
  taskType: TaskType;
  taskImageUrl?: string | null;
  status: AssignmentStatus;
  highlighted: boolean;
  dueAt: string | null;
  createdAt: string;
  submissionCount?: number;
}

export interface ClassSummary {
  id: string;
  teacherId: string;
  name: string;
  description: string | null;
  status: ClassStatus;
  createdAt: string;
  memberCount?: number;
  assignmentCount?: number;
  teacher?: Person;
}

export interface ClassMemberRow {
  id: string;
  joinedAt: string;
  removedAt: string | null;
  student: Person;
}

export interface InviteLinkRow {
  id: string;
  classId: string;
  teacherId: string;
  token: string;
  label: string | null;
  maxUses: number | null;
  useCount: number;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface ClassDetail extends ClassSummary {
  members: ClassMemberRow[];
  assignments: Assignment[];
  inviteLinks: InviteLinkRow[];
  /** Pending email invites; absent/empty in the student view. */
  invitations?: ClassInvitationRow[];
}

export interface ClassInvitationRow {
  id: string;
  email: string;
  createdAt: string;
}

/** What adding by email did: seated an existing student, or emailed an invite. */
export type AddMemberResult =
  | { outcome: "added"; member: ClassMemberRow }
  | { outcome: "invited"; invitation: ClassInvitationRow };

export interface InvitePreview {
  className: string;
  teacherName: string;
  valid: boolean;
  problem: string | null;
}

export interface RedoRequest {
  id: string;
  submissionId: string;
  teacherId: string;
  reason: string;
  status: RedoRequestStatus;
  createdAt: string;
  resolvedAt: string | null;
}

export interface PublishedResult {
  id: string;
  submissionId: string;
  revisionId: string;
  publishedBy: string;
  finalScores: Scores;
  finalFeedback: Feedback;
  publishedAt: string;
  unpublishedAt: string | null;
}

export interface ScoringResult {
  id: string;
  submissionId: string;
  scorerId: string | null;
  modelVersionId: string | null;
  scorerType: ScorerType;
  status: "completed" | "failed";
  scores: Scores;
  feedback: Feedback;
  processingMetadata?: Record<string, unknown> | null;
  createdAt: string;
  modelVersion?: {
    id: string;
    modelName: string;
    modelVersion: string;
    provider: string;
  } | null;
}

export interface ScoreRevision {
  id: string;
  submissionId: string;
  baseResultId: string | null;
  revisedBy: string;
  revisionNumber: number;
  changes: { score_changes?: Array<{ criterion: string; from: number; to: number }> };
  finalScores: Scores;
  finalFeedback: Feedback;
  revisionNote: string | null;
  createdAt: string;
}

/** How close this teacher is to being asked for reasons on this assignment. */
export interface ReasonPrompt {
  untaggedCount: number;
  threshold: number;
  shouldPrompt: boolean;
}

/**
 * `POST /submissions/:id/revisions` answers with the revision plus the prompt
 * state, so the client can open the batch modal without a second request.
 * Optional, because a server that has not shipped Task 8 yet simply omits it.
 */
export interface RevisionWithPrompt extends ScoreRevision {
  reasonPrompt?: ReasonPrompt;
}

/** Answer of `POST /submissions/:id/review-session`. */
export interface ReviewSession {
  recorded: boolean;
  sessionId: string | null;
}

/** One row of `GET /assignments/:id/revisions/untagged`. */
export interface UntaggedRevision {
  id: string;
  revisionNumber: number;
  changes: { score_changes?: ScoreChange[] } | null;
  revisionNote: string | null;
  createdAt: string;
  submission: {
    id: string;
    attemptNumber: number;
    student: { id: string; displayName: string };
  };
}

export interface SubmissionRow {
  id: string;
  assignmentId: string;
  studentId: string;
  attemptNumber: number;
  wordCount: number;
  status: SubmissionStatus;
  submittedAt: string;
  student?: Person;
  publishedResults?: Array<Pick<PublishedResult, "id" | "publishedAt" | "finalScores">>;
}

/** Teacher and admin read of one submission: the whole board record. */
export interface SubmissionFull extends SubmissionRow {
  essayText: string;
  assignment: Assignment;
  scoringResults: ScoringResult[];
  scoreRevisions: ScoreRevision[];
  publishedResults: PublishedResult[];
  openRedoRequest: RedoRequest | null;
  abuseReason: string | null;
  abuseDetails: Record<string, number | string> | null;
}

/** One row of the teacher's cross-assignment submissions list. */
export interface SubmissionListRow {
  id: string;
  assignmentId: string;
  studentId: string;
  attemptNumber: number;
  wordCount: number;
  status: SubmissionStatus;
  submittedAt: string;
  assignment: Assignment & { class?: ClassRef | null };
  student: Person;
  aiScores: Scores | null;
  publishedResult: PublishedResult | null;
  openRedoRequest: RedoRequest | null;
}

/** One row of a student's own cross-assignment submissions list. */
export interface StudentSubmissionListRow {
  id: string;
  assignmentId: string;
  studentId: string;
  attemptNumber: number;
  wordCount: number;
  status: SubmissionStatus;
  submittedAt: string;
  assignment: Pick<Assignment, "id" | "title" | "taskType">;
  publishedResult: PublishedResult | null;
  openRedoRequest: RedoRequest | null;
}

/** Student read: their own strip, plus the signed sheet once it exists. */
export interface SubmissionStudent {
  id: string;
  assignmentId: string;
  studentId: string;
  attemptNumber: number;
  essayText: string;
  wordCount: number;
  status: SubmissionStatus;
  submittedAt: string;
  assignment: Pick<Assignment, "id" | "title" | "taskPrompt" | "taskType" | "dueAt">;
  publishedResult: PublishedResult | null;
  redoRequest: { reason: string; createdAt: string } | null;
  message?: string;
  isFinalTeacherReviewedResult?: boolean;
}

export interface TimelineEntry {
  timestamp: string;
  type: "ai_scoring" | "teacher_revision" | "published_active" | "published_superseded";
  actor: string | null;
  details: ScoringResult | ScoreRevision | PublishedResult;
}

export interface TeacherHistory {
  submission: SubmissionRow & { assignment: Assignment };
  scoringResults: ScoringResult[];
  scoreRevisions: ScoreRevision[];
  publishedResults: PublishedResult[];
  timeline: TimelineEntry[];
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function errorMessage(res: Response): Promise<string> {
  let detail = "";
  try {
    const body = (await res.json()) as { message?: string | string[]; error?: string };
    const message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
    detail = message ?? body.error ?? "";
  } catch {
    detail = "";
  }
  if (detail) return detail;
  if (res.status === 401) return "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.";
  if (res.status === 403) return "Bạn không có quyền mở bài này.";
  if (res.status === 404) return "Không tìm thấy bài này trên bảng.";
  return `Máy chủ trả lỗi ${res.status}.`;
}

async function request<T>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(path, token, init);
  } catch {
    throw new ApiError(0, "Không kết nối được máy chủ Idest. Kiểm tra kết nối rồi thử lại.");
  }
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const getProfile = (token: string | null) => request<Profile>("/users/me", token);

export const updateProfile = (token: string | null, displayName: string) =>
  request<Profile>("/users/me", token, jsonInit("PATCH", { displayName }));

export interface TicketAttachmentInfo {
  id: string;
  title?: string;
  url: string;
  thumbnailUrl?: string;
  mimetype?: string;
}

export interface SupportTicket {
  id: string;
  subject: string;
  message: string;
  status: string;
  statusColor: string | null;
  /** ClickUp status type: 'open' | 'custom' | 'done' | 'closed'. */
  statusType: string | null;
  createdAt: string;
  /** Only set for admins, who see every ticket. */
  reporter: string | null;
  attachments?: TicketAttachmentInfo[];
}

export interface CreatedTicket extends SupportTicket {
  attachmentsUploaded: number;
  attachmentsFailed: number;
}

export const listTickets = (token: string | null) => request<SupportTicket[]>("/support/tickets", token);

export const submitTicket = (token: string | null, subject: string, message: string, images: File[] = []) => {
  const form = new FormData();
  form.append("subject", subject);
  form.append("message", message);
  for (const image of images) form.append("images", image);
  return request<CreatedTicket>("/support/tickets", token, { method: "POST", body: form });
};

export interface DeleteAccountSummary {
  message: string;
  classesDeleted: number;
  assignmentsArchived: number;
  studentsDeleted: number;
}

/**
 * Closes a teacher's board for good. `confirmEmail` must match the signed-in
 * account; the server refuses otherwise.
 */
export const deleteAccount = (token: string | null, confirmEmail: string) =>
  request<DeleteAccountSummary>("/users/me", token, jsonInit("DELETE", { confirmEmail }));

export const listAssignments = (token: string | null) =>
  request<Assignment[]>("/assignments", token);

export interface AssignmentPage {
  data: Assignment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ListAssignmentsParams {
  page?: number;
  limit?: number;
  status?: AssignmentStatus;
  taskType?: TaskType;
  classId?: string;
}

export const listAssignmentsPage = (token: string | null, params: ListAssignmentsParams) => {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.status) qs.set("status", params.status);
  if (params.taskType) qs.set("taskType", params.taskType);
  if (params.classId) qs.set("classId", params.classId);
  return request<AssignmentPage>(`/assignments?${qs.toString()}`, token);
};

export const getAssignment = (id: string, token: string | null) =>
  request<Assignment>(`/assignments/${id}`, token);

export const createAssignment = (
  token: string | null,
  body: { title: string; taskPrompt: string; taskType: TaskType; dueAt?: string; classId?: string },
) => request<Assignment>("/assignments", token, jsonInit("POST", body));

export const updateAssignmentStatus = (
  token: string | null,
  id: string,
  status: AssignmentStatus,
) => request<Assignment>(`/assignments/${id}/status`, token, jsonInit("PATCH", { status }));

export const updateAssignment = (
  token: string | null,
  id: string,
  body: Partial<{
    title: string;
    taskPrompt: string;
    classId: string | null;
    highlighted: boolean;
    dueAt: string | null;
  }>,
) => request<Assignment>(`/assignments/${id}`, token, jsonInit("PATCH", body));

export const deleteAssignment = (token: string | null, id: string) =>
  request<{ message: string; assignmentId: string }>(`/assignments/${id}`, token, { method: "DELETE" });

export const uploadAssignmentImage = (token: string | null, id: string, file: File) => {
  const form = new FormData();
  form.append("image", file);
  return request<Assignment>(`/assignments/${id}/image`, token, { method: "POST", body: form });
};

export const deleteAssignmentImage = (token: string | null, id: string) =>
  request<Assignment>(`/assignments/${id}/image`, token, { method: "DELETE" });

export const listSubmissions = (assignmentId: string, token: string | null) =>
  request<SubmissionRow[]>(`/assignments/${assignmentId}/submissions`, token);

export const submitEssay = (
  token: string | null,
  assignmentId: string,
  body: { essayText: string; idempotencyKey?: string },
) => request<SubmissionRow>(`/assignments/${assignmentId}/submissions`, token, jsonInit("POST", body));

export const getSubmission = <T = SubmissionFull>(id: string, token: string | null) =>
  request<T>(`/submissions/${id}`, token);

export const getHistory = <T = TeacherHistory>(submissionId: string, token: string | null) =>
  request<T>(`/submissions/${submissionId}/history`, token);

export const createRevision = (
  token: string | null,
  submissionId: string,
  body: {
    /** Omit when the teacher grades before the AI, or because it is unavailable. */
    baseResultId?: string;
    finalScores: Scores;
    finalFeedback: Feedback;
    revisionNote?: string;
  },
) =>
  request<RevisionWithPrompt>(
    `/submissions/${submissionId}/revisions`,
    token,
    jsonInit("POST", body),
  );

export const publishResult = (token: string | null, submissionId: string, revisionId: string) =>
  request<PublishedResult>(`/submissions/${submissionId}/publish`, token, jsonInit("POST", { revisionId }));

export const unpublishResult = (token: string | null, submissionId: string, reason?: string) =>
  request<{ message: string; submissionId: string; status: SubmissionStatus }>(
    `/submissions/${submissionId}/unpublish`,
    token,
    jsonInit("POST", reason ? { reason } : {}),
  );

export const listAllSubmissions = <T = SubmissionListRow[]>(token: string | null) =>
  request<T>("/submissions", token);

export interface SubmissionPage {
  data: SubmissionListRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ListSubmissionsParams {
  page?: number;
  limit?: number;
  status?: SubmissionStatus;
  q?: string;
}

export const listSubmissionsPage = (token: string | null, params: ListSubmissionsParams) => {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.status) qs.set("status", params.status);
  if (params.q) qs.set("q", params.q);
  return request<SubmissionPage>(`/submissions?${qs.toString()}`, token);
};

export const createRedoRequest = (token: string | null, submissionId: string, reason: string) =>
  request<RedoRequest>(`/submissions/${submissionId}/redo-requests`, token, jsonInit("POST", { reason }));

export const cancelRedoRequest = (token: string | null, submissionId: string, requestId: string) =>
  request<{ message: string }>(`/submissions/${submissionId}/redo-requests/${requestId}`, token, {
    method: "DELETE",
  });

export const retryScoring = (token: string | null, submissionId: string) =>
  request<SubmissionRow>(`/submissions/${submissionId}/retry-scoring`, token, jsonInit("POST", {}));

export const abuseReview = (
  token: string | null,
  submissionId: string,
  body: { decision: "confirm" | "reject"; action?: "requeue" | "manual" },
) => request<SubmissionRow>(`/submissions/${submissionId}/abuse-review`, token, jsonInit("POST", body));

// ── Capture: review timing and revision reasons ──────────────────────────

/**
 * Marks that this teacher opened the submission for review. The server
 * deduplicates repeat calls by the same actor inside a thirty-minute window,
 * so a page refresh does not inflate the review-duration sample.
 */
export const openReviewSession = (token: string | null, submissionId: string) =>
  request<ReviewSession>(
    `/submissions/${submissionId}/review-session`,
    token,
    jsonInit("POST", {}),
  );

/**
 * The same call with every failure swallowed.
 *
 * This is telemetry for a thesis metric, not part of grading. Losing a timing
 * sample is acceptable; showing the teacher an error about one is not.
 */
export async function recordReviewSessionQuietly(
  token: string | null,
  submissionId: string,
): Promise<ReviewSession | null> {
  try {
    return await openReviewSession(token, submissionId);
  } catch {
    return null;
  }
}

/** This teacher's revisions on one assignment that carry no reason yet. */
export const listUntaggedRevisions = (assignmentId: string, token: string | null) =>
  request<UntaggedRevision[]>(`/assignments/${assignmentId}/revisions/untagged`, token);

/**
 * Appends one reason set to several revisions under a single batch id. The
 * server writes them in one transaction and refuses the whole batch if any
 * revision is not the caller's.
 */
export const tagRevisionsBatch = (
  token: string | null,
  body: { revisionIds: string[]; reasonCodes: RevisionReason[]; note?: string },
) =>
  request<{ batchId: string; tagged: number }>(
    "/revision-reasons/batch",
    token,
    jsonInit("POST", body),
  );

// ── Classes ──────────────────────────────────────────────────────────────

export const listClasses = (token: string | null) => request<ClassSummary[]>("/classes", token);

export interface ClassPage {
  data: ClassSummary[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ListClassesParams {
  page?: number;
  limit?: number;
  status?: ClassStatus;
}

export const listClassesPage = (token: string | null, params: ListClassesParams) => {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.status) qs.set("status", params.status);
  return request<ClassPage>(`/classes?${qs.toString()}`, token);
};

export const getClass = (token: string | null, id: string) =>
  request<ClassDetail>(`/classes/${id}`, token);

export const createClass = (token: string | null, body: { name: string; description?: string }) =>
  request<ClassSummary>("/classes", token, jsonInit("POST", body));

export const updateClass = (
  token: string | null,
  id: string,
  body: Partial<{ name: string; description: string; status: ClassStatus }>,
) => request<ClassSummary>(`/classes/${id}`, token, jsonInit("PATCH", body));

export const deleteClass = (token: string | null, id: string) =>
  request<{ message: string; classId: string }>(`/classes/${id}`, token, { method: "DELETE" });

export const addClassMember = (token: string | null, classId: string, email: string) =>
  request<AddMemberResult>(`/classes/${classId}/members`, token, jsonInit("POST", { email }));

export const cancelClassInvitation = (token: string | null, classId: string, invitationId: string) =>
  request<{ message: string; invitationId: string }>(
    `/classes/${classId}/invitations/${invitationId}`,
    token,
    { method: "DELETE" },
  );

export const removeClassMember = (token: string | null, classId: string, studentId: string) =>
  request<{ message: string }>(`/classes/${classId}/members/${studentId}`, token, { method: "DELETE" });

export const createInviteLink = (
  token: string | null,
  classId: string,
  body: { label?: string; maxUses?: number; expiresAt?: string } = {},
) => request<InviteLinkRow>(`/classes/${classId}/invite-links`, token, jsonInit("POST", body));

export const revokeInviteLink = (token: string | null, linkId: string) =>
  request<{ message: string }>(`/invite-links/${linkId}`, token, { method: "DELETE" });

export const previewInviteLink = (token: string | null, inviteToken: string) =>
  request<InvitePreview>(`/invite-links/${inviteToken}`, token);

export const acceptInviteLink = (token: string | null, inviteToken: string) =>
  request<{ message: string; classId: string; className: string }>(
    `/invite-links/${inviteToken}/accept`,
    token,
    { method: "POST" },
  );

export interface OnboardingSteps {
  createClass: boolean;
  inviteStudent: boolean;
  inviteLink: boolean;
  createAssignment: boolean;
  openAssignment: boolean;
}

/** New-teacher checklist, derived server-side from the teacher's real rows. */
export interface OnboardingStatus {
  steps: OnboardingSteps;
  /** Newest active class; null when the teacher has none. */
  targetClassId: string | null;
  /** ISO UTC; null while the checklist card should show. */
  dismissedAt: string | null;
}

export const getOnboarding = (token: string | null) =>
  request<OnboardingStatus>("/users/me/onboarding", token);

export const setOnboardingDismissed = (token: string | null, dismissed: boolean) =>
  request<OnboardingStatus>("/users/me/onboarding", token, jsonInit("PATCH", { dismissed }));
