import type { OnboardingStatus, OnboardingSteps } from "./idest";

/** One spotlight per `?tour=` value; each matches a `[data-tour]` element. */
export type TourStepId =
  | "create-class"
  | "invite-student"
  | "invite-email"
  | "invite-link"
  | "create-assignment"
  | "open-assignment";

export interface TourStep {
  /** Position in the five-step checklist; both invite paths share step 2. */
  step: 1 | 2 | 3 | 4 | 5;
  title: string;
  body: string;
}

export const TOUR_STEP_COUNT = 5;

export const TOUR_STEPS: Record<TourStepId, TourStep> = {
  "create-class": {
    step: 1,
    title: "Tạo lớp học",
    body: 'Bấm vào đây, đặt tên lớp rồi bấm "Tạo lớp". Mỗi lớp là một nhóm học viên của bạn.',
  },
  "invite-student": {
    step: 2,
    title: "Mời học viên",
    body: 'Nhập email của học viên đã có tài khoản rồi bấm "Thêm". Học viên chưa có tài khoản? Dùng liên kết mời (bước 3) hoặc gửi email mời ở trang Tài khoản.',
  },
  "invite-email": {
    step: 2,
    title: "Mời học viên qua email",
    body: 'Nhập email rồi bấm "Gửi lời mời". Học viên nhận email, tạo tài khoản và vào bảng chấm của bạn.',
  },
  "invite-link": {
    step: 3,
    title: "Tạo liên kết mời",
    body: 'Bấm "Tạo liên kết mời", rồi "Copy link" hoặc "Copy QR" gửi cho học viên. Ai mở liên kết sẽ tự vào lớp này.',
  },
  "create-assignment": {
    step: 4,
    title: "Giao bài tập",
    body: "Bấm vào đây, nhập đề bài, chọn lớp và hạn nộp. Bài tập mới là bản nháp: học viên chưa thấy.",
  },
  "open-assignment": {
    step: 5,
    title: "Mở bài tập",
    body: 'Bấm "Mở bài tập" để học viên thấy đề và nộp bài.',
  },
};

/** Own keys only: `?tour=toString` must not match a prototype member. */
export function isTourStepId(value: unknown): value is TourStepId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TOUR_STEPS, value);
}

/** Where a checklist action goes; null when the step is blocked. */
export function tourHref(id: TourStepId, status: OnboardingStatus): string | null {
  const klass = status.targetClassId ? encodeURIComponent(status.targetClassId) : null;
  switch (id) {
    case "create-class":
      return "/teacher/classes?tour=create-class";
    case "invite-student":
      return klass ? `/teacher/classes/${klass}?tab=students&tour=invite-student` : null;
    case "invite-email":
      return "/profile?tour=invite-email";
    case "invite-link":
      return klass ? `/teacher/classes/${klass}?tab=invites&tour=invite-link` : null;
    case "create-assignment":
      return "/teacher/assignments?tour=create-assignment";
    case "open-assignment":
      return status.steps.createAssignment ? "/teacher/assignments?tour=open-assignment" : null;
  }
}

export const NEEDS_CLASS = "Cần một lớp đang hoạt động — tạo lớp trước";
export const NEEDS_ASSIGNMENT = "Giao bài tập trước";

export interface ChecklistAction {
  tour: TourStepId;
  label: string;
  /** Null when the action is blocked; `blockedReason` then says why. */
  href: string | null;
  blockedReason: string | null;
  /** Rendered as the primary `press`; at most one action on the card has it. */
  primary: boolean;
}

export interface ChecklistRow {
  key: keyof OnboardingSteps;
  title: string;
  hint: string;
  done: boolean;
  actions: ChecklistAction[];
}

const ROWS: { key: keyof OnboardingSteps; title: string; hint: string; tours: TourStepId[] }[] = [
  {
    key: "createClass",
    title: "Tạo lớp học",
    hint: "Mỗi lớp là một nhóm học viên của bạn.",
    tours: ["create-class"],
  },
  {
    key: "inviteStudent",
    title: "Mời học viên",
    hint: "Thêm học viên đã có tài khoản, hoặc gửi email mời.",
    tours: ["invite-student", "invite-email"],
  },
  {
    key: "inviteLink",
    title: "Tạo liên kết mời",
    hint: "Học viên mở liên kết là tự vào lớp.",
    tours: ["invite-link"],
  },
  {
    key: "createAssignment",
    title: "Giao bài tập",
    hint: "Bài tập mới là bản nháp, học viên chưa thấy.",
    tours: ["create-assignment"],
  },
  {
    key: "openAssignment",
    title: "Mở bài tập",
    hint: "Mở bài tập để học viên thấy đề và nộp bài.",
    tours: ["open-assignment"],
  },
];

function actionLabel(tour: TourStepId, done: boolean): string {
  if (tour === "invite-email") return "hoặc gửi email mời";
  if (done) return "Xem lại";
  return tour === "invite-student" ? "Thêm bằng email →" : "Làm →";
}

/**
 * The card's rows, in order. The first action of the first undone,
 * unblocked row is the single primary action.
 */
export function checklistRows(status: OnboardingStatus): ChecklistRow[] {
  let primaryTaken = false;
  return ROWS.map((row) => {
    const done = status.steps[row.key];
    const actions = row.tours.map((tour, index) => {
      const href = tourHref(tour, status);
      const primary = !primaryTaken && !done && index === 0 && href !== null;
      if (primary) primaryTaken = true;
      return {
        tour,
        label: actionLabel(tour, done),
        href,
        blockedReason: href === null ? (tour === "open-assignment" ? NEEDS_ASSIGNMENT : NEEDS_CLASS) : null,
        primary,
      };
    });
    return { key: row.key, title: row.title, hint: row.hint, done, actions };
  });
}

export function doneCount(status: OnboardingStatus): number {
  return Object.values(status.steps).filter(Boolean).length;
}

export type ClassTab = "students" | "assignments" | "invites";

/** Class detail's initial tab from `?tab=`; anything unknown opens students. */
export function classTabFromParam(value: string | string[] | undefined): ClassTab {
  const first = Array.isArray(value) ? value[0] : value;
  return first === "assignments" || first === "invites" ? first : "students";
}

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface BubblePlacement {
  top: number;
  left: number;
  placement: "below" | "above" | "center";
}

export const BUBBLE_GAP = 12;
export const VIEWPORT_GUTTER = 16;

/** Like Math.min(Math.max(...)), but `min` wins when the range is inverted. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Fixed-position coordinates for the hint bubble: below the target, flipped
 * above when it does not fit, always inside a 16px gutter. No target means
 * the viewport centre.
 */
export function placeBubble(target: Rect | null, bubble: Size, viewport: Size): BubblePlacement {
  const maxLeft = viewport.width - VIEWPORT_GUTTER - bubble.width;
  const maxTop = viewport.height - VIEWPORT_GUTTER - bubble.height;

  if (!target) {
    return {
      top: clamp((viewport.height - bubble.height) / 2, VIEWPORT_GUTTER, maxTop),
      left: clamp((viewport.width - bubble.width) / 2, VIEWPORT_GUTTER, maxLeft),
      placement: "center",
    };
  }

  const left = clamp(target.left + target.width / 2 - bubble.width / 2, VIEWPORT_GUTTER, maxLeft);
  // Every branch clamps vertically: a target scrolled off-screen must not
  // take the bubble (and its "Đã hiểu" button) with it.
  const below = target.top + target.height + BUBBLE_GAP;
  if (below <= maxTop) return { top: clamp(below, VIEWPORT_GUTTER, maxTop), left, placement: "below" };

  const above = target.top - BUBBLE_GAP - bubble.height;
  if (above >= VIEWPORT_GUTTER) return { top: clamp(above, VIEWPORT_GUTTER, maxTop), left, placement: "above" };

  // Neither side fits (a very tall target): keep the bubble on screen.
  return { top: clamp(below, VIEWPORT_GUTTER, maxTop), left, placement: "below" };
}

/** The current URL without `?tour=`: where ending a tour leaves the teacher. */
export function tourExitUrl(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete("tour");
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
