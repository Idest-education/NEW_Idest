import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import amqp from 'amqplib';
import type { ConfigService } from '@nestjs/config';
import { RabbitMQService, redactAmqpUrl } from './rabbitmq.service.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('redactAmqpUrl', () => {
  it('removes the password from a credentialed broker url', () => {
    const out = redactAmqpUrl('amqps://user:sup3rs3cret@broker.example.com/vhost');
    expect(out).not.toContain('sup3rs3cret');
    expect(out).toBe('amqps://user:***@broker.example.com/vhost');
  });

  it('leaves a local url without credentials readable', () => {
    expect(redactAmqpUrl('amqp://localhost:5672')).toBe('amqp://localhost:5672');
  });

  it('never returns the original string when a password is present', () => {
    const raw = 'amqps://u:p@h/v';
    expect(redactAmqpUrl(raw)).not.toBe(raw);
  });

  it('degrades safely on an unparseable url rather than echoing it', () => {
    expect(redactAmqpUrl('not a url')).toBe('<redacted>');
  });
});

describe('RabbitMQService broker failure handling', () => {
  function fakeBroker() {
    const conn = new EventEmitter() as EventEmitter & Record<string, unknown>;
    const channel = new EventEmitter() as EventEmitter & Record<string, unknown>;
    channel.assertQueue = vi.fn().mockResolvedValue(undefined);
    channel.close = vi.fn().mockResolvedValue(undefined);
    conn.createChannel = vi.fn().mockResolvedValue(channel);
    conn.close = vi.fn().mockResolvedValue(undefined);
    return { conn, channel };
  }

  function makeService(conn: unknown) {
    vi.spyOn(amqp, 'connect').mockResolvedValue(conn as never);
    const config = { get: () => 'amqp://user:pw@localhost:5672' } as unknown as ConfigService;
    return new RabbitMQService(config);
  }

  it('survives an error event on the connection instead of crashing the process', async () => {
    const { conn } = fakeBroker();
    const service = makeService(conn);
    await service.onModuleInit();
    expect(service.isBrokerConnected()).toBe(true);

    // amqplib emits this on a dropped socket. An EventEmitter with no 'error'
    // listener throws, which takes the whole API server down.
    expect(() => conn.emit('error', new Error('read ETIMEDOUT'))).not.toThrow();
    expect(service.isBrokerConnected()).toBe(false);
  });

  it('survives an error event on the channel', async () => {
    const { conn, channel } = fakeBroker();
    const service = makeService(conn);
    await service.onModuleInit();

    expect(() => channel.emit('error', new Error('channel died'))).not.toThrow();
    expect(service.isBrokerConnected()).toBe(false);
  });

  it('marks itself disconnected when the connection closes', async () => {
    const { conn } = fakeBroker();
    const service = makeService(conn);
    await service.onModuleInit();

    conn.emit('close');
    expect(service.isBrokerConnected()).toBe(false);
  });

  it('refuses to publish once the broker has dropped, rather than throwing', async () => {
    const { conn } = fakeBroker();
    const service = makeService(conn);
    await service.onModuleInit();
    conn.emit('error', new Error('read ETIMEDOUT'));

    await expect(
      service.publishScoringJob({
        submissionId: 's-1', assignmentId: 'a-1', studentId: 'stu-1', attemptNumber: 1,
        taskPrompt: 'p', taskType: 'task_2', essayText: 'e', wordCount: 1,
        submittedAt: new Date().toISOString(),
      }),
    ).resolves.toBe(false);
  });
});
