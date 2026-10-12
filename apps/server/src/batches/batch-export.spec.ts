import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildBatchWorkbook, type ExportItem } from './batch-export.js';

const SCORES = {
  overall: 6.5,
  task_response: 6,
  coherence_cohesion: 7,
  lexical_resource: 6.5,
  grammatical_range_accuracy: 6,
};

function item(row: number, extra: Partial<ExportItem> = {}): ExportItem {
  return {
    sourceFileId: 'f1',
    sourceRef: { row, studentLabel: `S${row}` },
    essayText: 'essay',
    status: 'scored',
    scores: SCORES,
    summary: 'Clear position.',
    final: false,
    ...extra,
  };
}

async function read(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

describe('buildBatchWorkbook', () => {
  it("appends score columns to the teacher's own sheet, row for row", async () => {
    const source = new ExcelJS.Workbook();
    source.addWorksheet('Cover').addRow(['Class 10A']);
    const sheet = source.addWorksheet('Essays');
    sheet.addRow(['Danh sách']);
    sheet.addRow(['Họ tên', 'Bài viết']);
    sheet.addRow(['An', 'essay one']);
    sheet.addRow(['Bình', 'essay two']);
    const content = [new Uint8Array(await source.xlsx.writeBuffer())];

    const out = await read(
      await buildBatchWorkbook(
        [{ id: 'f1', kind: 'xlsx', fileName: 'class.xlsx', content, extraction: { mapping: { sheet: 'Essays', header_row: 1 } } }],
        [item(2, { final: true }), item(3, { scores: null, status: 'failed' })],
      ),
    );

    const essays = out.getWorksheet('Essays')!;
    expect(out.getWorksheet('Cover')!.getCell('A1').value).toBe('Class 10A');
    expect(essays.getRow(2).values).toEqual([
      undefined,
      'Họ tên',
      'Bài viết',
      'Overall',
      'Task Response',
      'Coherence & Cohesion',
      'Lexical Resource',
      'Grammatical Range & Accuracy',
      'Feedback',
      'Grading status',
    ]);
    expect(essays.getRow(3).getCell(3).value).toBe(6.5);
    expect(essays.getRow(3).getCell(9).value).toBe('Teacher final');
    expect(essays.getRow(4).getCell(9).value).toBe('Not graded (failed)');
  });

  it('writes a plain results sheet when the essays came from several files', async () => {
    const out = await read(
      await buildBatchWorkbook(
        [
          { id: 'f1', kind: 'pdf', fileName: 'a.pdf', content: [], extraction: {} },
          { id: 'f2', kind: 'image', fileName: 'b.jpg', content: [], extraction: {} },
        ],
        [item(0), item(1, { sourceFileId: 'f2' })],
      ),
    );

    const sheet = out.getWorksheet('Results')!;
    expect(sheet.getRow(1).getCell(1).value).toBe('Student');
    expect(sheet.getRow(3).values).toEqual([undefined, 'S1', 'b.jpg', 'essay', 6.5, 6, 7, 6.5, 6, 'Clear position.', 'AI draft']);
  });
});
