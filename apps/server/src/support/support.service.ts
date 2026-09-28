import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';
import type { CreateTicketDto } from './dto/create-ticket.dto.js';

const CLICKUP_API = 'https://api.clickup.com/api/v2';
const FAILURE_MESSAGE = 'Không gửi được yêu cầu. Thử lại sau.';
const LIST_FAILURE_MESSAGE = 'Không tải được danh sách yêu cầu. Thử lại sau.';
/** Separates the user's message from the reporter footer the server appends. */
const FOOTER_SEPARATOR = '\n---\n';
/** 100 tasks per ClickUp page; stop well before a runaway loop. */
const MAX_LIST_PAGES = 10;

export interface TicketAttachment {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

export interface TicketAttachmentInfo {
  id: string;
  title?: string;
  url: string;
  thumbnailUrl?: string;
  mimetype?: string;
}

export interface SupportTicket {
  id: string;
  subject: string;
  message: string;
  status: string;
  statusColor: string | null;
  /** ClickUp status type: 'open' | 'custom' | 'done' | 'closed'. */
  statusType: string | null;
  createdAt: string;
  /** Only filled for admins: the footer carries the reporter's email. */
  reporter: string | null;
  attachments?: TicketAttachmentInfo[];
}

export interface CreatedTicket extends SupportTicket {
  attachmentsUploaded: number;
  attachmentsFailed: number;
}

interface ClickUpAttachment {
  id: string;
  title?: string;
  url?: string;
  thumbnail_small?: string;
  thumbnail_medium?: string;
  thumbnail_large?: string;
  url_w_host?: string;
  mimetype?: string;
  extension?: string;
}

interface ClickUpTask {
  id: string;
  name: string;
  description?: string | null;
  text_content?: string | null;
  status?: { status?: string; color?: string; type?: string } | null;
  date_created?: string | null;
  attachments?: ClickUpAttachment[] | null;
}

interface ClickUpConfig {
  token: string;
  listId: string;
}

function splitDescription(description: string): { message: string; footer: string } {
  const at = description.lastIndexOf(FOOTER_SEPARATOR);
  if (at === -1) return { message: description.trim(), footer: '' };
  return {
    message: description.slice(0, at).trim(),
    footer: description.slice(at + FOOTER_SEPARATOR.length),
  };
}

function footerValue(footer: string, prefix: string): string | null {
  const line = footer.split('\n').find((l) => l.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : null;
}

function isImageAttachment(att: ClickUpAttachment): boolean {
  if (att.mimetype && att.mimetype.startsWith('image/')) return true;
  if (att.thumbnail_small || att.thumbnail_medium || att.thumbnail_large) return true;
  if (att.extension && ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif'].includes(att.extension.toLowerCase())) return true;
  const urlOrTitle = att.url ?? att.title ?? '';
  return /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(urlOrTitle);
}

function toTicket(task: ClickUpTask, withReporter: boolean): SupportTicket {
  const { message, footer } = splitDescription(task.description ?? task.text_content ?? '');
  const created = Number(task.date_created);

  const rawAttachments = task.attachments ?? [];
  const imageAttachments: TicketAttachmentInfo[] = rawAttachments
    .filter(isImageAttachment)
    .map((att) => {
      const url = att.url ?? att.url_w_host ?? att.thumbnail_large ?? att.thumbnail_small ?? '';
      const thumbnailUrl = att.thumbnail_small ?? att.thumbnail_medium ?? att.thumbnail_large ?? url;
      return {
        id: att.id,
        title: att.title ?? '',
        url,
        thumbnailUrl,
        mimetype: att.mimetype ?? '',
      };
    })
    .filter((att) => Boolean(att.url));

  return {
    id: task.id,
    subject: task.name,
    message,
    status: task.status?.status ?? 'unknown',
    statusColor: task.status?.color ?? null,
    statusType: task.status?.type ?? null,
    createdAt: Number.isFinite(created) ? new Date(created).toISOString() : new Date(0).toISOString(),
    reporter: withReporter ? footerValue(footer, 'Từ:') : null,
    attachments: imageAttachments.length > 0 ? imageAttachments : undefined,
  };
}

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(private readonly configService: ConfigService) {}

  async createTicket(
    user: User,
    dto: CreateTicketDto,
    attachments: TicketAttachment[] = [],
  ): Promise<CreatedTicket> {
    const { token, listId } = this.clickUpConfig(FAILURE_MESSAGE);

    const description = [
      dto.message,
      '',
      '---',
      `Từ: ${user.displayName} <${user.email}> (${user.role})`,
      `Gửi lúc: ${new Date().toISOString()}`,
    ].join('\n');

    let res: Response;
    try {
      res = await fetch(`${CLICKUP_API}/list/${listId}/task`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: dto.subject, description }),
      });
    } catch (err) {
      this.logger.error('ClickUp request failed', err instanceof Error ? err.stack : String(err));
      throw new ServiceUnavailableException(FAILURE_MESSAGE);
    }

    if (!res.ok) {
      this.logger.error(`ClickUp returned ${res.status}: ${await res.text()}`);
      throw new ServiceUnavailableException(FAILURE_MESSAGE);
    }

    const task = (await res.json()) as ClickUpTask;

    // The ticket already exists at this point, so a failed attachment must
    // not turn into a 503 — the user would resubmit and file a duplicate.
    // Report the count instead and let the client say which part failed.
    let attachmentsUploaded = 0;
    for (const file of attachments) {
      if (await this.uploadAttachment(token, task.id, file)) attachmentsUploaded += 1;
    }

    return {
      ...toTicket({ ...task, description: task.description ?? description }, false),
      attachmentsUploaded,
      attachmentsFailed: attachments.length - attachmentsUploaded,
    };
  }

  /**
   * Every user sees every ticket, so the board shows the support activity is
   * real. Only admins get the reporter line, which carries an email address.
   */
  async listTickets(user: User): Promise<SupportTicket[]> {
    const { token, listId } = this.clickUpConfig(LIST_FAILURE_MESSAGE);
    const isAdmin = user.role === 'admin';

    const tasks: ClickUpTask[] = [];
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const url =
        `${CLICKUP_API}/list/${listId}/task?archived=false&include_closed=true` +
        `&subtasks=false&order_by=created&include_attachments=true&page=${page}`;
      let res: Response;
      try {
        res = await fetch(url, { headers: { Authorization: token } });
      } catch (err) {
        this.logger.error('ClickUp list request failed', err instanceof Error ? err.stack : String(err));
        throw new ServiceUnavailableException(LIST_FAILURE_MESSAGE);
      }
      if (!res.ok) {
        this.logger.error(`ClickUp list returned ${res.status}: ${await res.text()}`);
        throw new ServiceUnavailableException(LIST_FAILURE_MESSAGE);
      }
      const body = (await res.json()) as { tasks?: ClickUpTask[]; last_page?: boolean };
      const batch = body.tasks ?? [];
      tasks.push(...batch);
      if (body.last_page !== false || batch.length === 0) break;
    }

    // Fallback: If any task has no attachments property, fetch task details in parallel
    await Promise.all(
      tasks.map(async (task) => {
        if (task.attachments === undefined) {
          try {
            const taskRes = await fetch(`${CLICKUP_API}/task/${task.id}`, {
              headers: { Authorization: token },
            });
            if (taskRes.ok) {
              const detailedTask = (await taskRes.json()) as ClickUpTask;
              task.attachments = detailedTask.attachments ?? [];
            }
          } catch {
            // Ignore failure for individual task detail fetch
          }
        }
      }),
    );

    return tasks
      .map((task) => toTicket(task, isAdmin))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private clickUpConfig(failureMessage: string): ClickUpConfig {
    try {
      return {
        token: this.configService.getOrThrow<string>('CLICKUP_TOKEN'),
        listId: this.configService.getOrThrow<string>('CLICKUP_SUPPORT_LIST_ID'),
      };
    } catch (err) {
      this.logger.error('ClickUp is not configured', err instanceof Error ? err.stack : String(err));
      throw new ServiceUnavailableException(failureMessage);
    }
  }

  private async uploadAttachment(token: string, taskId: string, file: TicketAttachment): Promise<boolean> {
    const form = new FormData();
    form.append('attachment', new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }), file.originalname);
    try {
      const res = await fetch(`${CLICKUP_API}/task/${taskId}/attachment`, {
        method: 'POST',
        headers: { Authorization: token },
        body: form,
      });
      if (!res.ok) {
        this.logger.error(`ClickUp attachment for task ${taskId} returned ${res.status}: ${await res.text()}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.error(
        `ClickUp attachment for task ${taskId} failed`,
        err instanceof Error ? err.stack : String(err),
      );
      return false;
    }
  }
}
