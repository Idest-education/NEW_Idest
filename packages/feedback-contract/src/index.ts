/**
 * The Idest feedback questionnaire, defined once. The web form renders from
 * it, the server validates answers against it, and the SPSS export builds its
 * columns and labels from it. Spec:
 * docs/superpowers/specs/2026-09-28-feedback-survey-design.md
 *
 * Keep this ONE file of erasable-only TypeScript: no enums, no namespaces, no
 * constructor parameter properties, no relative imports. The server's compiled
 * JavaScript imports this source at runtime, which Node can only do through
 * type stripping.
 */

export type SurveyRole = 'teacher' | 'student';
export type SectionId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I';
export type ItemType = 'likert5' | 'choice' | 'nps' | 'number' | 'text';
export type MeasureLevel = 'nominal' | 'ordinal' | 'scale';

/** Bump whenever an item is added, removed, reworded or recoded. */
export const INSTRUMENT_VERSION = 1;
export const TEXT_MAX_LENGTH = 2000;

export interface SurveyOption {
  code: number;
  label: string;
}

export interface SurveyItem {
  /** SPSS variable name: lowercase, at most 12 characters. */
  code: string;
  section: SectionId;
  roles: readonly SurveyRole[];
  type: ItemType;
  /** One wording, or one per role when the wording is adapted. */
  label: string | Readonly<Record<SurveyRole, string>>;
  /** Short neutral English label for SPSS VARIABLE LABELS. */
  varLabel: string;
  level: MeasureLevel;
  required: boolean;
  options?: readonly SurveyOption[];
  /** Codes SPSS treats as user-missing, e.g. "no band yet". */
  missingCodes?: readonly number[];
  min?: number;
  max?: number;
  maxLength?: number;
}

export interface SurveySection {
  id: SectionId;
  title: string | Readonly<Record<SurveyRole, string>>;
  roles: readonly SurveyRole[];
}

export type Answers = Record<string, number | string>;

export type AnswerErrorReason = 'required' | 'unknown' | 'not_for_role' | 'type' | 'range' | 'too_long';

export interface AnswerError {
  code: string;
  reason: AnswerErrorReason;
}

export type ValidationResult = { ok: true; answers: Answers } | { ok: false; errors: AnswerError[] };

const TEACHER: readonly SurveyRole[] = ['teacher'];
const STUDENT: readonly SurveyRole[] = ['student'];
const BOTH: readonly SurveyRole[] = ['teacher', 'student'];

export const LIKERT5: readonly SurveyOption[] = [
  { code: 1, label: 'Rất không đồng ý' },
  { code: 2, label: 'Không đồng ý' },
  { code: 3, label: 'Trung lập' },
  { code: 4, label: 'Đồng ý' },
  { code: 5, label: 'Rất đồng ý' },
];

export const NPS_OPTIONS: readonly SurveyOption[] = Array.from({ length: 11 }, (_, code) => ({
  code,
  label: String(code),
}));

export const NPS_ANCHORS = { low: 'Chắc chắn không', high: 'Chắc chắn có' } as const;

export function isSurveyRole(value: unknown): value is SurveyRole {
  return value === 'teacher' || value === 'student';
}

/** Options coded 1..n in the order given. */
function coded(...labels: string[]): SurveyOption[] {
  return labels.map((label, index) => ({ code: index + 1, label }));
}

function likert(
  code: string,
  section: SectionId,
  roles: readonly SurveyRole[],
  label: SurveyItem['label'],
  varLabel: string,
): SurveyItem {
  return { code, section, roles, type: 'likert5', label, varLabel, level: 'ordinal', required: true };
}

function choice(
  code: string,
  roles: readonly SurveyRole[],
  label: string,
  varLabel: string,
  level: MeasureLevel,
  options: readonly SurveyOption[],
  section: SectionId = 'A',
): SurveyItem {
  return { code, section, roles, type: 'choice', label, varLabel, level, required: true, options };
}

function minutes(code: string, label: string, varLabel: string): SurveyItem {
  return {
    code,
    section: 'E',
    roles: TEACHER,
    type: 'number',
    label,
    varLabel,
    level: 'scale',
    required: true,
    min: 1,
    max: 180,
  };
}

function openText(code: string, label: string, varLabel: string): SurveyItem {
  return {
    code,
    section: 'I',
    roles: BOTH,
    type: 'text',
    label,
    varLabel,
    level: 'nominal',
    required: false,
    maxLength: TEXT_MAX_LENGTH,
  };
}

export const SECTIONS: readonly SurveySection[] = [
  { id: 'A', title: 'Thông tin chung', roles: BOTH },
  { id: 'B', title: 'Mức độ dễ sử dụng', roles: BOTH },
  { id: 'C', title: 'Mức độ hữu ích', roles: BOTH },
  {
    id: 'D',
    title: { teacher: 'Chất lượng chấm của AI', student: 'Chất lượng kết quả nhận được' },
    roles: BOTH,
  },
  { id: 'E', title: 'Quy trình chấm', roles: TEACHER },
  { id: 'F', title: 'Mức độ hài lòng', roles: BOTH },
  { id: 'G', title: 'Ý định sử dụng', roles: BOTH },
  { id: 'H', title: 'Mức độ sẵn lòng giới thiệu', roles: BOTH },
  { id: 'I', title: 'Ý kiến thêm', roles: BOTH },
];

export const ITEMS: readonly SurveyItem[] = [
  // A. Profile
  choice('t_exp', TEACHER, 'Bạn đã dạy IELTS được bao lâu?', 'Years teaching IELTS', 'ordinal',
    coded('Dưới 1 năm', '1–2 năm', '3–5 năm', '6–10 năm', 'Trên 10 năm')),
  choice('t_students', TEACHER, 'Mỗi tháng bạn chấm bài Writing cho khoảng bao nhiêu học viên?',
    'Writing students per month', 'ordinal', coded('1–5', '6–15', '16–30', '31–50', 'Trên 50')),
  choice('t_work', TEACHER, 'Hình thức dạy chính của bạn?', 'Main teaching setting', 'nominal',
    coded('Gia sư tự do', 'Trung tâm ngoại ngữ', 'Trường học', 'Khác')),
  choice('t_prior', TEACHER, 'Trước khi dùng Idest, bạn chấm Writing chủ yếu bằng cách nào?',
    'Grading method before Idest', 'nominal',
    coded('Chấm tay trên giấy', 'Nhận xét trên Word/Google Docs', 'Công cụ AI (ChatGPT, Gemini…)',
      'Nền tảng chấm bài khác', 'Khác')),
  choice('ai_use', TEACHER, 'Bạn dùng công cụ AI (ChatGPT, Gemini…) thường xuyên đến mức nào?',
    'Frequency of AI tool use', 'ordinal',
    coded('Chưa bao giờ', 'Hiếm khi', 'Thỉnh thoảng', 'Thường xuyên', 'Hằng ngày')),
  choice('s_target', STUDENT, 'Band Writing mục tiêu của bạn?', 'Target Writing band', 'ordinal',
    coded('5.0 trở xuống', '5.5', '6.0', '6.5', '7.0', '7.5 trở lên')),
  {
    ...choice('s_current', STUDENT, 'Band Writing gần nhất của bạn (thi thật hoặc thi thử)?',
      'Latest Writing band', 'ordinal',
      [{ code: 0, label: 'Chưa có' }, ...coded('4.5 trở xuống', '5.0', '5.5', '6.0', '6.5', '7.0 trở lên')]),
    missingCodes: [0],
  },
  choice('s_tests', STUDENT, 'Bạn đã thi IELTS chính thức bao nhiêu lần?', 'Official IELTS attempts',
    'ordinal', coded('Chưa thi', '1 lần', '2 lần', '3 lần trở lên')),
  choice('s_purpose', STUDENT, 'Mục đích chính khi thi IELTS?', 'Main purpose for IELTS', 'nominal',
    coded('Du học', 'Định cư', 'Công việc', 'Tốt nghiệp / tuyển sinh', 'Khác')),
  choice('device', BOTH, 'Bạn dùng Idest chủ yếu trên thiết bị nào?', 'Main device', 'nominal',
    coded('Máy tính (để bàn/laptop)', 'Máy tính bảng', 'Điện thoại')),

  // B. Ease of use — UMUX-Lite
  likert('ux1', 'B', BOTH, 'Các chức năng của Idest đáp ứng được nhu cầu của tôi.',
    'UMUX-Lite 1: capabilities meet my requirements'),
  likert('ux2', 'B', BOTH, 'Idest dễ sử dụng.', 'UMUX-Lite 2: easy to use'),

  // C. Perceived usefulness (role-adapted wording)
  likert('pu1', 'C', BOTH,
    { teacher: 'Idest giúp tôi chấm bài Writing nhanh hơn.', student: 'Idest giúp tôi cải thiện kỹ năng viết.' },
    'Usefulness 1 (role-adapted): faster grading / better writing'),
  likert('pu2', 'C', BOTH,
    {
      teacher: 'Idest giúp tôi quản lý bài viết của học viên dễ dàng hơn.',
      student: 'Idest giúp tôi theo dõi tiến bộ của mình dễ dàng hơn.',
    },
    'Usefulness 2 (role-adapted): manage students / track progress'),
  likert('pu3', 'C', BOTH,
    {
      teacher: 'Nhìn chung, Idest hữu ích cho công việc giảng dạy của tôi.',
      student: 'Nhìn chung, Idest hữu ích cho việc ôn thi IELTS của tôi.',
    },
    'Usefulness 3 (role-adapted): useful overall'),

  // D. Teacher: AI scoring quality
  likert('aiq1', 'D', TEACHER, 'Điểm tổng (overall band) AI đưa ra gần với điểm tôi sẽ cho.',
    'AI: overall band close to mine'),
  likert('aiq2', 'D', TEACHER, 'Điểm từng tiêu chí (TR, CC, LR, GRA) của AI chính xác.',
    'AI: criterion scores accurate'),
  likert('aiq3', 'D', TEACHER, 'Nhận xét của AI cụ thể và đúng trọng tâm.', 'AI: feedback specific and relevant'),
  likert('aiq4', 'D', TEACHER, 'AI chấm nhất quán giữa các bài có chất lượng tương đương.',
    'AI: consistent across similar essays'),
  likert('aiq5', 'D', TEACHER, 'Tôi tin bản chấm của AI là điểm khởi đầu đáng tin cậy.',
    'AI: trusted as a starting point'),
  choice('aiq_weak', TEACHER, 'Tiêu chí nào AI chấm lệch nhiều nhất?', 'AI: least accurate criterion', 'nominal',
    coded('Task Response/Achievement', 'Coherence & Cohesion', 'Lexical Resource',
      'Grammatical Range & Accuracy', 'Không lệch rõ / không chắc'), 'D'),

  // D. Student: quality of the published result
  likert('fq1', 'D', STUDENT, 'Nhận xét trên bài của tôi dễ hiểu.', 'Result: feedback easy to understand'),
  likert('fq2', 'D', STUDENT, 'Nhận xét chỉ rõ tôi cần cải thiện điều gì.', 'Result: says what to improve'),
  likert('fq3', 'D', STUDENT, 'Tôi nhận được kết quả đủ nhanh.', 'Result: arrived fast enough'),
  likert('fq4', 'D', STUDENT, 'Kết quả tôi nhận được giống một bài chấm thật của giáo viên.',
    'Result: feels like a real teacher assessment'),

  // E. Teacher workflow
  likert('wf1', 'E', TEACHER, 'Quy trình xem lại, sửa và duyệt kết quả rõ ràng.', 'Workflow: review flow is clear'),
  likert('wf2', 'E', TEACHER, 'Sửa điểm và nhận xét trên Idest thuận tiện.', 'Workflow: editing is convenient'),
  likert('wf3', 'E', TEACHER, 'Tôi kiểm soát hoàn toàn kết quả cuối cùng gửi cho học viên.',
    'Workflow: I control the final result'),
  minutes('min_before', 'Trước khi dùng Idest, trung bình bạn mất bao nhiêu phút để chấm một bài Writing?',
    'Minutes per essay before Idest'),
  minutes('min_now', 'Với Idest, trung bình bạn mất bao nhiêu phút cho một bài (gồm xem lại và duyệt)?',
    'Minutes per essay with Idest'),

  // F. Satisfaction
  likert('sat1', 'F', BOTH, 'Nhìn chung, tôi hài lòng với Idest.', 'Satisfaction: overall'),
  likert('sat2', 'F', BOTH,
    {
      teacher: 'Idest tốt hơn cách tôi chấm bài trước đây.',
      student: 'Idest tốt hơn cách tôi luyện viết trước đây.',
    },
    'Satisfaction: better than previous method (role-adapted)'),

  // G. Intention to use
  likert('bi1', 'G', BOTH, 'Tôi muốn tiếp tục dùng Idest.', 'Intention to keep using'),
  choice('wtp', TEACHER, 'Mức phí hằng tháng bạn sẵn sàng trả cho Idest?', 'Willingness to pay per month',
    'ordinal', coded('Không trả phí', 'Dưới 100.000đ', '100.000–200.000đ', '200.000–500.000đ', 'Trên 500.000đ'),
    'G'),

  // H. Net Promoter Score
  {
    code: 'nps',
    section: 'H',
    roles: BOTH,
    type: 'nps',
    label: 'Bạn có sẵn lòng giới thiệu Idest cho người khác không? (0 = chắc chắn không, 10 = chắc chắn có)',
    varLabel: 'Likelihood to recommend (NPS 0-10)',
    level: 'scale',
    required: true,
  },

  // I. Open comments
  openText('open_like', 'Bạn thích điều gì nhất ở Idest?', 'Open: liked most'),
  openText('open_improve', 'Idest nên cải thiện điều gì trước tiên?', 'Open: improve first'),
  openText('open_other', 'Góp ý khác (nếu có).', 'Open: other comments'),
];

export function itemsFor(role: SurveyRole): SurveyItem[] {
  return ITEMS.filter((item) => item.roles.includes(role));
}

export function sectionsFor(role: SurveyRole): SurveySection[] {
  return SECTIONS.filter((section) => section.roles.includes(role));
}

export function labelFor(item: SurveyItem, role: SurveyRole): string {
  return typeof item.label === 'string' ? item.label : item.label[role];
}

export function sectionTitle(section: SurveySection, role: SurveyRole): string {
  return typeof section.title === 'string' ? section.title : section.title[role];
}

const ITEM_BY_CODE = new Map<string, SurveyItem>(ITEMS.map((item) => [item.code, item] as const));

type Checked =
  | { kind: 'skip' }
  | { kind: 'value'; value: number | string }
  | { kind: 'error'; reason: AnswerErrorReason };

function numericBounds(item: SurveyItem): { min: number; max: number } {
  if (item.type === 'likert5') return { min: 1, max: 5 };
  if (item.type === 'nps') return { min: 0, max: 10 };
  return { min: item.min ?? 0, max: item.max ?? Number.MAX_SAFE_INTEGER };
}

const NUL = /\u0000/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * PostgreSQL JSONB rejects NUL and unpaired surrogates (a textarea's
 * maxLength can cut an emoji in half), which would turn a save into a 500.
 */
function storableText(value: string): string {
  return value.replace(NUL, '').replace(LONE_SURROGATE, '�').trim();
}

function checkValue(item: SurveyItem, value: unknown): Checked {
  if (value === null || value === undefined) return { kind: 'skip' };
  if (item.type === 'text') {
    if (typeof value !== 'string') return { kind: 'error', reason: 'type' };
    const text = storableText(value);
    if (text === '') return { kind: 'skip' };
    if (text.length > (item.maxLength ?? TEXT_MAX_LENGTH)) return { kind: 'error', reason: 'too_long' };
    return { kind: 'value', value: text };
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) return { kind: 'error', reason: 'type' };
  if (item.type === 'choice') {
    return item.options?.some((option) => option.code === value)
      ? { kind: 'value', value }
      : { kind: 'error', reason: 'range' };
  }
  const { min, max } = numericBounds(item);
  return value >= min && value <= max ? { kind: 'value', value } : { kind: 'error', reason: 'range' };
}

/**
 * Checks a submitted answer object against the questionnaire for one role and
 * returns only normalised values. Errors name the item code; a malformed
 * payload (not a plain object) is one error with an empty code.
 */
export function validateAnswers(role: SurveyRole, input: unknown): ValidationResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: [{ code: '', reason: 'type' }] };
  }
  const errors: AnswerError[] = [];
  const answers: Answers = {};
  for (const [code, value] of Object.entries(input)) {
    const item = ITEM_BY_CODE.get(code);
    if (!item) {
      errors.push({ code, reason: 'unknown' });
      continue;
    }
    if (!item.roles.includes(role)) {
      errors.push({ code, reason: 'not_for_role' });
      continue;
    }
    const checked = checkValue(item, value);
    if (checked.kind === 'error') errors.push({ code, reason: checked.reason });
    else if (checked.kind === 'value') answers[code] = checked.value;
  }
  for (const item of itemsFor(role)) {
    const failed = errors.some((error) => error.code === item.code);
    if (item.required && answers[item.code] === undefined && !failed) {
      errors.push({ code: item.code, reason: 'required' });
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, answers };
}

/** UMUX-Lite on a 0–100 scale; null unless both items are answered. */
export function umuxLite(answers: Answers): number | null {
  const { ux1, ux2 } = answers;
  if (typeof ux1 !== 'number' || typeof ux2 !== 'number') return null;
  return ((ux1 - 1 + (ux2 - 1)) / 8) * 100;
}

/**
 * SUS-comparable estimate from UMUX-Lite (Lewis, Utesch & Maher 2013),
 * rounded to one decimal. An estimate, not a measured SUS score.
 */
export function umuxSus(answers: Answers): number | null {
  const lite = umuxLite(answers);
  return lite === null ? null : Math.round((0.65 * lite + 22.9) * 10) / 10;
}
