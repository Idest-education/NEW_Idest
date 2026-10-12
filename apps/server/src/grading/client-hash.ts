import { createHmac } from 'node:crypto';
import type { Request } from 'express';

/**
 * Keyed hash of the caller's IP: enough to count free gradings per visitor
 * without storing the address itself.
 * Fly's proxy overwrites Fly-Client-IP, so the header cannot be spoofed there.
 */
export function clientHash(req: Pick<Request, 'headers' | 'ip'>, secret: string): string {
  const header = req.headers['fly-client-ip'];
  const ip = (Array.isArray(header) ? header[0] : header) ?? req.ip ?? 'unknown';
  return createHmac('sha256', secret).update(ip).digest('hex');
}
