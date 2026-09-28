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
  id: 'user-1',
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

  it('uploads each image as a ClickUp attachment on the new task', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'task-1', name: DTO.subject }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const service = new SupportService(makeConfig());
    const image = { buffer: Buffer.from('png'), originalname: 'shot.png', mimetype: 'image/png' };
    const result = await service.createTicket(USER, DTO, [image, image]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(String(url)).toBe('https://api.clickup.com/api/v2/task/task-1/attachment');
    expect(init.headers.Authorization).toBe('tok_abc');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('attachment')).toBeInstanceOf(Blob);
    expect(result).toMatchObject({ id: 'task-1', attachmentsUploaded: 2, attachmentsFailed: 0 });
  });

  it('keeps the filed ticket when an attachment upload fails, and reports the failure', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'task-1', name: DTO.subject }), { status: 200 }))
      .mockResolvedValueOnce(new Response('too big', { status: 413 }));

    const service = new SupportService(makeConfig());
    const image = { buffer: Buffer.from('png'), originalname: 'shot.png', mimetype: 'image/png' };
    const result = await service.createTicket(USER, DTO, [image]);

    expect(result).toMatchObject({ id: 'task-1', attachmentsUploaded: 0, attachmentsFailed: 1 });
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

  it('turns a missing ClickUp env var into a ServiceUnavailableException, not a raw 500', async () => {
    const config = {
      getOrThrow: vi.fn(() => {
        throw new Error('missing config CLICKUP_TOKEN');
      }),
    } as unknown as ConfigService;

    const service = new SupportService(config);
    await expect(service.createTicket(USER, DTO)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function task(id: string, footer: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `Ticket ${id}`,
    description: `Nội dung ${id}\n\n---\n${footer}`,
    status: { status: 'to do', color: '#87909e', type: 'open' },
    date_created: String(Date.UTC(2026, 8, Number(id.replace(/\D/g, '')) || 1)),
    ...extra,
  };
}

describe('SupportService.listTickets', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  const tasks = [
    task('t1', 'Từ: Cô Lan <teacher@example.com> (teacher)'),
    task('t2', 'Từ: Other <other@example.com> (student)'),
    task('t3', 'Từ: Cô Lan <teacher@example.com> (teacher)'),
    task('t4', 'Từ: Third <third@example.com> (student)'),
  ];

  it('returns every ticket, newest first, with the footer stripped and no reporter for non-admins', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ tasks, last_page: true }), { status: 200 }));

    const service = new SupportService(makeConfig());
    const result = await service.listTickets(USER);

    expect(result.map((t) => t.id)).toEqual(['t4', 't3', 't2', 't1']);
    expect(result.find((t) => t.id === 't1')).toMatchObject({
      subject: 'Ticket t1',
      message: 'Nội dung t1',
      status: 'to do',
      statusType: 'open',
      reporter: null,
    });
    expect(result.every((t) => t.reporter === null)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/list/list_123/task?');
    expect(String(url)).toContain('include_closed=true');
    expect(init.headers.Authorization).toBe('tok_abc');
  });

  it('returns every ticket with its reporter for an admin', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ tasks, last_page: true }), { status: 200 }));

    const service = new SupportService(makeConfig());
    const result = await service.listTickets({ ...USER, role: 'admin' } as User);

    expect(result).toHaveLength(4);
    expect(result.find((t) => t.id === 't2')?.reporter).toBe('Other <other@example.com> (student)');
  });

  it('follows ClickUp pagination until last_page', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ tasks: [tasks[0]], last_page: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tasks: [tasks[2]], last_page: true }), { status: 200 }));

    const service = new SupportService(makeConfig());
    const result = await service.listTickets(USER);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]![0])).toContain('page=1');
    expect(result).toHaveLength(2);
  });

  it('turns a ClickUp error into a ServiceUnavailableException', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));

    const service = new SupportService(makeConfig());
    await expect(service.listTickets(USER)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
