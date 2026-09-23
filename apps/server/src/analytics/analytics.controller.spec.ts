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
