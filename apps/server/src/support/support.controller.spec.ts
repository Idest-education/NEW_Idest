import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { SupportController } from './support.controller.js';
import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';

const reflector = new Reflector();

describe('SupportController authorization', () => {
  it('has no role restriction on createTicket — any authenticated user may file a ticket', () => {
    const roles = reflector.get<string[] | undefined>(ROLES_KEY, SupportController.prototype.createTicket);
    expect(roles ?? []).toEqual([]);
  });

  it('has no role restriction on listTickets — the service scopes results to the caller', () => {
    const roles = reflector.get<string[] | undefined>(ROLES_KEY, SupportController.prototype.listTickets);
    expect(roles ?? []).toEqual([]);
  });
});
