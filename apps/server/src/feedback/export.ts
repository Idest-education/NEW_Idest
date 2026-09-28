import type { FeedbackResponse } from '@prisma/client';
import {
  INSTRUMENT_VERSION,
  ITEMS,
  LIKERT5,
  NPS_ANCHORS,
  umuxLite,
  umuxSus,
  type Answers,
  type MeasureLevel,
  type SurveyItem,
  type SurveyOption,
} from '@repo/feedback-contract';
import { csvHeader, csvRow } from '../analytics/serialize.js';

export type ExportRow = Pick<
  FeedbackResponse,
  'id' | 'role' | 'instrumentVersion' | 'answers' | 'usage' | 'editCount' | 'createdAt' | 'updatedAt'
>;

const ROLE_CODE: Record<string, number> = { teacher: 1, student: 2 };

const META: readonly { column: string; format: string; label: string }[] = [
  { column: 'resp_id', format: 'A36', label: 'Response id (pseudonymous)' },
  { column: 'role', format: 'F1.0', label: 'Respondent role' },
  { column: 'instr_ver', format: 'F2.0', label: 'Instrument version' },
  { column: 'created_at', format: 'A24', label: 'First submitted (UTC)' },
  { column: 'updated_at', format: 'A24', label: 'Last edited (UTC)' },
  { column: 'edit_count', format: 'F4.0', label: 'Number of edits' },
];

const USAGE: readonly { column: string; key: string; label: string }[] = [
  { column: 'u_graded', key: 'graded', label: 'Usage: submissions graded (teacher)' },
  { column: 'u_classes', key: 'classes', label: 'Usage: classes' },
  { column: 'u_assign', key: 'assignments', label: 'Usage: assignments (teacher)' },
  { column: 'u_subs', key: 'submissions', label: 'Usage: submissions (student)' },
  { column: 'u_published', key: 'published', label: 'Usage: results received (student)' },
  { column: 'u_age_days', key: 'age_days', label: 'Usage: account age in days' },
];

const SCORES: readonly { column: string; label: string }[] = [
  { column: 'umux_lite', label: 'UMUX-Lite score (0-100)' },
  { column: 'umux_sus', label: 'SUS-comparable estimate from UMUX-Lite' },
];

export const CSV_COLUMNS: string[] = [
  ...META.map((m) => m.column),
  ...USAGE.map((u) => u.column),
  ...ITEMS.map((item) => item.code),
  ...SCORES.map((s) => s.column),
];

/** Scale means computed in SPSS; every item must be a Likert item in the contract. */
export const CONSTRUCTS: readonly { name: string; label: string; items: readonly string[] }[] = [
  { name: 'pu_m', label: 'Perceived usefulness (mean)', items: ['pu1', 'pu2', 'pu3'] },
  { name: 'aiq_m', label: 'AI scoring quality (mean, teachers)', items: ['aiq1', 'aiq2', 'aiq3', 'aiq4', 'aiq5'] },
  { name: 'fq_m', label: 'Result quality (mean, students)', items: ['fq1', 'fq2', 'fq3', 'fq4'] },
  { name: 'wf_m', label: 'Workflow (mean, teachers)', items: ['wf1', 'wf2', 'wf3'] },
  { name: 'sat_m', label: 'Satisfaction (mean)', items: ['sat1', 'sat2'] },
];

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * SPSS `GET DATA /DELCASE=LINE` starts a new case at every line break, even
 * inside quotes, so open text is flattened to one line in the export only.
 */
function oneLine(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(/\s*[\r\n]+\s*/g, ' ') : value;
}

export function toCsv(rows: readonly ExportRow[]): string {
  let out = csvHeader(CSV_COLUMNS);
  for (const row of rows) {
    const answers = asRecord(row.answers);
    const usage = asRecord(row.usage);
    const flat: Record<string, unknown> = {
      resp_id: row.id,
      role: ROLE_CODE[row.role] ?? null,
      instr_ver: row.instrumentVersion,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
      edit_count: row.editCount,
      umux_lite: umuxLite(answers as Answers),
      umux_sus: umuxSus(answers as Answers),
    };
    for (const { column, key } of USAGE) flat[column] = usage[key] ?? null;
    for (const item of ITEMS) flat[item.code] = oneLine(answers[item.code] ?? null);
    out += csvRow(CSV_COLUMNS, flat);
  }
  return out;
}

function quote(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

function itemFormat(item: SurveyItem): string {
  switch (item.type) {
    case 'likert5':
    case 'choice':
      return 'F1.0';
    case 'nps':
      return 'F2.0';
    case 'number':
      return 'F3.0';
    case 'text':
      // 2000 characters of Vietnamese can take up to three UTF-8 bytes each.
      return 'A6000';
  }
}

function formatOf(column: string): string {
  const meta = META.find((m) => m.column === column);
  if (meta) return meta.format;
  if (USAGE.some((u) => u.column === column)) return 'F6.0';
  const item = ITEMS.find((i) => i.code === column);
  return item ? itemFormat(item) : 'F5.1';
}

function labelOf(column: string): string {
  return (
    META.find((m) => m.column === column)?.label ??
    USAGE.find((u) => u.column === column)?.label ??
    ITEMS.find((i) => i.code === column)?.varLabel ??
    SCORES.find((s) => s.column === column)?.label ??
    column
  );
}

/** Variable names eight to a line, so no syntax line gets long. */
function wrapNames(names: readonly string[], indent: string): string[] {
  const lines: string[] = [];
  for (let i = 0; i < names.length; i += 8) lines.push(`${indent}${names.slice(i, i + 8).join(' ')}`);
  return lines;
}

function valueGroup(names: readonly string[], options: readonly SurveyOption[], first: boolean): string[] {
  const head = wrapNames(names, '    ');
  head[0] = `  ${first ? '' : '/'}${head[0]!.trimStart()}`;
  return [...head, ...options.map((option) => `    ${option.code} ${quote(option.label)}`)];
}

function codesAt(level: MeasureLevel): string[] {
  return ITEMS.filter((item) => item.level === level && item.type !== 'text').map((item) => item.code);
}

/** One VARIABLE LEVEL list; only its first line may start with a slash. */
function levelList(names: readonly string[], first: boolean, level: string, last: boolean): string[] {
  const lines = wrapNames(names, '    ');
  lines[0] = `  ${first ? '' : '/'}${lines[0]!.trimStart()}`;
  return [...lines, `  (${level})${last ? '.' : ''}`];
}

/** SPSS syntax that imports the CSV of the same export and labels it. */
export function toSps(csvFilename: string): string {
  const lines: string[] = [
    `* Idest feedback survey, instrument v${INSTRUMENT_VERSION}.`,
    `* Keep this file and ${csvFilename} in one folder. If SPSS cannot`,
    '* find the CSV, replace the file name below with its full path.',
    `FILE HANDLE feedback /NAME=${quote(csvFilename)}.`,
    "GET DATA /TYPE=TXT /FILE=feedback /ENCODING='UTF8'",
    `  /DELCASE=LINE /DELIMITERS="," /QUALIFIER='"' /ARRANGEMENT=DELIMITED /FIRSTCASE=2`,
    '  /VARIABLES=',
    ...CSV_COLUMNS.map((column) => `  ${column} ${formatOf(column)}`),
  ];
  lines[lines.length - 1] += '.';

  lines.push('VARIABLE LABELS', ...CSV_COLUMNS.map((column) => `  ${column} ${quote(labelOf(column))}`));
  lines[lines.length - 1] += '.';

  const likertCodes = ITEMS.filter((item) => item.type === 'likert5').map((item) => item.code);
  lines.push(
    'VALUE LABELS',
    ...valueGroup(['role'], [{ code: 1, label: 'Giáo viên' }, { code: 2, label: 'Học viên' }], true),
    ...valueGroup(likertCodes, LIKERT5, false),
  );
  for (const item of ITEMS) {
    if (item.type === 'choice') lines.push(...valueGroup([item.code], item.options ?? [], false));
    if (item.type === 'nps') {
      lines.push(
        ...valueGroup([item.code], [{ code: 0, label: NPS_ANCHORS.low }, { code: 10, label: NPS_ANCHORS.high }], false),
      );
    }
  }
  lines[lines.length - 1] += '.';

  for (const item of ITEMS) {
    if (item.missingCodes?.length) lines.push(`MISSING VALUES ${item.code} (${item.missingCodes.join(', ')}).`);
  }

  const scale = [
    'instr_ver',
    'edit_count',
    ...USAGE.map((u) => u.column),
    ...codesAt('scale'),
    ...SCORES.map((s) => s.column),
  ];
  lines.push(
    'VARIABLE LEVEL',
    ...levelList(['role', ...codesAt('nominal')], true, 'NOMINAL', false),
    ...levelList(codesAt('ordinal'), false, 'ORDINAL', false),
    ...levelList(scale, false, 'SCALE', true),
  );

  for (const construct of CONSTRUCTS) {
    lines.push(`COMPUTE ${construct.name} = MEAN.${construct.items.length}(${construct.items.join(', ')}).`);
  }
  lines.push('COMPUTE time_saved = min_before - min_now.');
  lines.push(
    'VARIABLE LABELS',
    ...CONSTRUCTS.map((construct) => `  ${construct.name} ${quote(construct.label)}`),
    `  time_saved ${quote('Minutes saved per essay')}.`,
  );
  lines.push(`FORMATS ${CONSTRUCTS.map((construct) => construct.name).join(' ')} (F4.2) time_saved (F4.0).`);
  lines.push('EXECUTE.');
  // Without a BOM, SPSS on Windows can read the syntax in the local code page
  // and garble every Vietnamese value label.
  return `﻿${lines.join('\n')}\n`;
}
