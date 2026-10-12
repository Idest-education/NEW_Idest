import ExcelJS from 'exceljs';

export interface ExportFile {
  id: string;
  kind: string;
  fileName: string;
  content: Uint8Array[];
  extraction: unknown;
}

export interface ExportItem {
  sourceFileId: string | null;
  sourceRef: unknown;
  essayText: string;
  status: string;
  scores: Record<string, number> | null;
  summary: string | null;
  final: boolean;
}

const SCORE_COLUMNS: [string, (i: ExportItem) => string | number | null][] = [
  ['Overall', (i) => i.scores?.overall ?? null],
  ['Task Response', (i) => i.scores?.task_response ?? null],
  ['Coherence & Cohesion', (i) => i.scores?.coherence_cohesion ?? null],
  ['Lexical Resource', (i) => i.scores?.lexical_resource ?? null],
  ['Grammatical Range & Accuracy', (i) => i.scores?.grammatical_range_accuracy ?? null],
  ['Feedback', (i) => i.summary],
  ['Grading status', (i) => (i.scores ? (i.final ? 'Teacher final' : 'AI draft') : `Not graded (${i.status})`)],
];

function scoreCells(item: ExportItem): (string | number | null)[] {
  return SCORE_COLUMNS.map(([, read]) => read(item));
}

/**
 * The teacher's own spreadsheet with score columns appended to the essays'
 * rows, when the whole batch came from one .xlsx; otherwise a plain results sheet.
 */
export async function buildBatchWorkbook(files: ExportFile[], items: ExportItem[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const only = files.length === 1 ? files[0] : null;
  const mapping = (only?.extraction as { mapping?: { sheet: string; header_row: number } } | null)?.mapping;

  if (only?.kind === 'xlsx' && mapping) {
    await workbook.xlsx.load(Buffer.from(only.content[0]) as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet(mapping.sheet);
    if (sheet) {
      const first = sheet.columnCount + 1;
      if (mapping.header_row >= 0) {
        SCORE_COLUMNS.forEach(([title], k) => {
          const cell = sheet.getRow(mapping.header_row + 1).getCell(first + k);
          cell.value = title;
          cell.font = { bold: true };
        });
      }
      for (const item of items) {
        const row = (item.sourceRef as { row?: number } | null)?.row;
        if (typeof row !== 'number') continue;
        scoreCells(item).forEach((value, k) => {
          sheet.getRow(row + 1).getCell(first + k).value = value;
        });
      }
      return Buffer.from(await workbook.xlsx.writeBuffer());
    }
  }

  const names = new Map(files.map((f) => [f.id, f.fileName]));
  const sheet = workbook.addWorksheet('Results');
  sheet.addRow(['Student', 'File', 'Essay', ...SCORE_COLUMNS.map(([title]) => title)]).font = { bold: true };
  for (const item of items) {
    const label = (item.sourceRef as { studentLabel?: string | null } | null)?.studentLabel ?? null;
    sheet.addRow([label, item.sourceFileId ? names.get(item.sourceFileId) ?? null : null, item.essayText, ...scoreCells(item)]);
  }
  sheet.getColumn(3).width = 60;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
