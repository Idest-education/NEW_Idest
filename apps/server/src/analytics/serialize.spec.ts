import { describe, expect, it } from 'vitest';
import { EXPORT_COLUMNS, columnsFor, csvRow, jsonlRow, toPlain } from './serialize.js';

describe('columnsFor', () => {
  it('leaves essay text out unless it is asked for', () => {
    expect(columnsFor(false)).not.toContain('essay_text');
    expect(columnsFor(true)).toContain('essay_text');
    expect(columnsFor(true)).toHaveLength(EXPORT_COLUMNS.length + 1);
  });

  it('never carries anything that identifies a student', () => {
    for (const column of columnsFor(true)) {
      expect(column).not.toMatch(/email|display_name|clerk/);
    }
    expect(columnsFor(true)).toContain('student_id');
  });
});

describe('toPlain', () => {
  it('passes plain values through', () => {
    expect(toPlain('x')).toBe('x');
    expect(toPlain(3)).toBe(3);
    expect(toPlain(true)).toBe(true);
    expect(toPlain(null)).toBeNull();
    expect(toPlain(undefined)).toBeNull();
  });

  it('renders a Date as an ISO-8601 instant', () => {
    expect(toPlain(new Date('2026-09-15T08:03:00.000Z'))).toBe('2026-09-15T08:03:00.000Z');
  });

  it('unwraps a Prisma Decimal into a number', () => {
    const decimal = { toNumber: () => 0.5, toString: () => '0.5' };
    expect(toPlain(decimal)).toBe(0.5);
  });

  it('converts a bigint into a number', () => {
    expect(toPlain(7n)).toBe(7);
  });

  it('joins an enum array with a pipe', () => {
    expect(toPlain(['ai_too_generous', 'minor_polish'])).toBe('ai_too_generous|minor_polish');
  });
});

describe('csvRow', () => {
  it('writes an empty field for null', () => {
    expect(csvRow(['a', 'b'], { a: null, b: 2 })).toBe(',2\n');
  });

  it('quotes and doubles quotes when a value contains a comma, quote or newline', () => {
    expect(csvRow(['a'], { a: 'one,two' })).toBe('"one,two"\n');
    expect(csvRow(['a'], { a: 'he said "hi"' })).toBe('"he said ""hi"""\n');
    expect(csvRow(['a'], { a: 'line\nbreak' })).toBe('"line\nbreak"\n');
  });
});

describe('jsonlRow', () => {
  it('emits one JSON object per line with only the requested columns', () => {
    const line = jsonlRow(['submission_id', 'ai_overall'], {
      submission_id: 'sub-1',
      ai_overall: { toNumber: () => 6.5, toString: () => '6.5' },
      essay_text: 'should not appear',
    });
    expect(line).toBe('{"submission_id":"sub-1","ai_overall":6.5}\n');
  });
});

describe('csv formula injection', () => {
  it('neutralises a student essay that begins like a spreadsheet formula', () => {
    const row = { essay_text: '=cmd|\'/c calc\'!A1', submission_id: 's-1' };
    const line = csvRow(['submission_id', 'essay_text'], row);

    // The cell must not reach a spreadsheet with a leading formula trigger.
    const cell = line.trim().split(',').slice(1).join(',');
    expect(cell.replace(/^"/, '').startsWith('=')).toBe(false);
  });

  it.each(['=1+1', '+1', '-1+1', '@SUM(A1)', '\tx', '\rx'])(
    'neutralises the leading trigger %j in free text',
    (text) => {
      const cell = csvRow(['essay_text'], { essay_text: text }).trim();
      expect(/^"?[=+\-@\t\r]/.test(cell)).toBe(false);
    },
  );

  it('leaves negative numbers alone, so deltas stay numeric', () => {
    const line = csvRow(['delta_overall', 'abs_delta_overall'], {
      delta_overall: -0.5,
      abs_delta_overall: 0.5,
    });
    expect(line).toBe('-0.5,0.5\n');
  });

  it('leaves a Prisma Decimal negative value numeric', () => {
    const decimal = { toNumber: () => -1.5 };
    expect(csvRow(['delta_overall'], { delta_overall: decimal })).toBe('-1.5\n');
  });
});
