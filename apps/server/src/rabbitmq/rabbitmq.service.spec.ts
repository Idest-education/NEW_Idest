import { describe, expect, it } from 'vitest';
import { redactAmqpUrl } from './rabbitmq.service.js';

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
