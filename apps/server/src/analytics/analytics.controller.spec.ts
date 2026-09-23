import { describe, expect, it, vi } from 'vitest';
import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';
import type { AnalyticsService } from './analytics.service.js';
import { AnalyticsController } from './analytics.controller.js';

function makeService() {
  return {
    getOverview: vi.fn(),
    getScoringHealth: vi.fn(),
  } as unknown as AnalyticsService & {
    getOverview: ReturnType<typeof vi.fn>;
    getScoringHealth: ReturnType<typeof vi.fn>;
  };
}

describe('AnalyticsController', () => {
  it('gates the whole controller on the admin role', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AnalyticsController)).toEqual(['admin']);
  });

  it('returns the overview unchanged', async () => {
    const service = makeService();
    const overview = { totals: { submissionsWithRevision: 1, publishedCount: 1 } };
    service.getOverview.mockResolvedValue(overview);

    const controller = new AnalyticsController(service);

    await expect(controller.overview()).resolves.toBe(overview);
  });

  it('forwards the window to the scoring-health query', async () => {
    const service = makeService();
    service.getScoringHealth.mockResolvedValue([]);

    const controller = new AnalyticsController(service);
    await controller.scoringHealth({ from: '2026-09-01', to: '2026-09-30' });

    expect(service.getScoringHealth).toHaveBeenCalledWith({
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });
});

describe('AnalyticsController.export', () => {
  function makeResponse() {
    return {
      setHeader: vi.fn(),
      write: vi.fn().mockReturnValue(true),
      end: vi.fn(),
    };
  }

  it('audits the export, sets the CSV headers, and writes every chunk', async () => {
    const service = makeService();
    service.beginExport = vi.fn().mockResolvedValue('export-1');
    service.streamExport = vi.fn().mockImplementation(async function* () {
      yield 'header\n';
      yield 'row\n';
    });
    const res = makeResponse();
    const controller = new AnalyticsController(service);

    await controller.export(
      { id: 'admin-1' } as never,
      { format: 'csv' },
      res as never,
    );

    expect(service.beginExport).toHaveBeenCalledWith('admin-1', {
      format: 'csv',
      from: undefined,
      to: undefined,
      includeEssays: false,
    });
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith('X-Export-Id', 'export-1');
    expect(res.write).toHaveBeenNthCalledWith(1, 'header\n');
    expect(res.write).toHaveBeenNthCalledWith(2, 'row\n');
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('defaults to csv and to leaving essays out', async () => {
    const service = makeService();
    service.beginExport = vi.fn().mockResolvedValue('export-2');
    service.streamExport = vi.fn().mockImplementation(async function* () {
      yield '';
    });
    const controller = new AnalyticsController(service);

    await controller.export({ id: 'admin-1' } as never, {}, makeResponse() as never);

    expect(service.streamExport).toHaveBeenCalledWith({
      format: 'csv',
      from: undefined,
      to: undefined,
      includeEssays: false,
    });
  });

  it('passes include_essays through and switches the content type for jsonl', async () => {
    const service = makeService();
    service.beginExport = vi.fn().mockResolvedValue('export-3');
    service.streamExport = vi.fn().mockImplementation(async function* () {
      yield '';
    });
    const res = makeResponse();
    const controller = new AnalyticsController(service);

    await controller.export(
      { id: 'admin-1' } as never,
      { format: 'jsonl', include_essays: true },
      res as never,
    );

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/x-ndjson');
    expect(service.streamExport).toHaveBeenCalledWith({
      format: 'jsonl',
      from: undefined,
      to: undefined,
      includeEssays: true,
    });
  });
});
