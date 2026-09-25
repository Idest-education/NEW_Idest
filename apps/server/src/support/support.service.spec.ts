import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';
import { SupportService } from './support.service.js';

function makeConfig(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    CLICKUP_TOKEN: 'tok_abc',
    CLICKUP_SUPPORT_LIST_ID: 'list_123',
    ...overrides,
  };
  return {
    getOrThrow: vi.fn((key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error(`missing config ${key}`);
      return value;
    }),
  } as unknown as ConfigService;
}

const USER = {
  displayName: 'Cô Lan',
  email: 'teacher@example.com',
  role: 'teacher',
} as User;

const DTO = { subject: 'Không nộp được bài', message: 'Bấm Nộp bài nhưng không có phản hồi.' };

describe('SupportService.createTicket', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('posts a ClickUp task with the raw token header and a reporter footer', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'task-1' }), { status: 200 }));

    const service = new SupportService(makeConfig());
    await service.createTicket(USER, DTO);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.clickup.com/api/v2/list/list_123/task');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('tok_abc');
    expect(init.headers.Authorization).not.toMatch(/^Bearer/);
    const body = JSON.parse(init.body as string);
    expect(body.name).toBe(DTO.subject);
    expect(body.description).toContain(DTO.message);
    expect(body.description).toContain('teacher@example.com');
    expect(body.description).toContain('teacher');
  });

  it('turns a ClickUp error response into a ServiceUnavailableException, not a raw throw', async () => {
    fetchMock.mockResolvedValue(new Response('rate limited', { status: 429 }));

    const service = new SupportService(makeConfig());
    await expect(service.createTicket(USER, DTO)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('turns a network failure into a ServiceUnavailableException', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const service = new SupportService(makeConfig());
    await expect(service.createTicket(USER, DTO)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
