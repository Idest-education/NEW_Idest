import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import type { User } from '@prisma/client';
import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';
import { FeedbackController } from './feedback.controller.js';
import type { FeedbackService } from './feedback.service.js';

function roles(method: keyof FeedbackController): unknown {
  return Reflect.getMetadata(ROLES_KEY, FeedbackController.prototype[method]);
}

function makeService() {
  return {
    state: vi.fn(),
    save: vi.fn(),
    dismissPrompt: vi.fn(),
    exportFile: vi.fn(),
  } as unknown as FeedbackService & Record<'state' | 'save' | 'dismissPrompt' | 'exportFile', ReturnType<typeof vi.fn>>;
}

const teacher = { id: 'teacher-1', role: 'teacher' } as unknown as User;

describe('FeedbackController', () => {
  it('opens the survey routes to teachers and students only', () => {
    expect(roles('me')).toEqual(['teacher', 'student']);
    expect(roles('save')).toEqual(['teacher', 'student']);
  });

  it('lets only teachers dismiss the pop-up and only admins export', () => {
    expect(roles('dismissPrompt')).toEqual(['teacher']);
    expect(roles('export')).toEqual(['admin']);
  });

  it('passes the version and raw answers to the service', async () => {
    const service = makeService();
    service.save.mockResolvedValue({ editCount: 0 });
    const controller = new FeedbackController(service);

    await controller.save(teacher, { instrumentVersion: 1, answers: { ux1: 4 } });

    expect(service.save).toHaveBeenCalledWith(teacher, 1, { ux1: 4 });
  });

  it('streams the export as an attachment that is never cached', async () => {
    const service = makeService();
    service.exportFile.mockResolvedValue({
      filename: 'feedback-2026-09-28.csv',
      contentType: 'text/csv; charset=utf-8',
      body: 'resp_id\n',
    });
    const res = { setHeader: vi.fn(), send: vi.fn() };
    const controller = new FeedbackController(service);

    await controller.export({ id: 'admin-1' } as unknown as User, {}, res as unknown as Response);

    expect(service.exportFile).toHaveBeenCalledWith('admin-1', 'csv');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="feedback-2026-09-28.csv"',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.send).toHaveBeenCalledWith('resp_id\n');
  });
});
