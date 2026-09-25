import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';
import type { CreateTicketDto } from './dto/create-ticket.dto.js';

const CLICKUP_API = 'https://api.clickup.com/api/v2';
const FAILURE_MESSAGE = 'Không gửi được yêu cầu. Thử lại sau.';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(private readonly configService: ConfigService) {}

  async createTicket(user: User, dto: CreateTicketDto): Promise<void> {
    let token: string;
    let listId: string;
    try {
      token = this.configService.getOrThrow<string>('CLICKUP_TOKEN');
      listId = this.configService.getOrThrow<string>('CLICKUP_SUPPORT_LIST_ID');
    } catch (err) {
      this.logger.error('ClickUp is not configured', err instanceof Error ? err.stack : String(err));
      throw new ServiceUnavailableException(FAILURE_MESSAGE);
    }

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
  }
}
