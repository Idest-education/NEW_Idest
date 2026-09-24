import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { AssessmentsController } from './assessments.controller.js';
import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';

const reflector = new Reflector();

function rolesFor(method: keyof AssessmentsController): string[] {
  return reflector.get<string[]>(ROLES_KEY, AssessmentsController.prototype[method]) ?? [];
}

describe('AssessmentsController authorization', () => {
  // assessments.service.ts guards these three with
  // `role !== Role.teacher && role !== Role.admin`, so admins are meant to be
  // allowed. While the decorator said 'teacher' only, RolesGuard rejected an
  // admin first and that service check was unreachable for them.
  it.each(['createTeacherRevision', 'publishResult', 'unpublishResult'] as const)(
    'lets an admin call %s, matching the service it delegates to',
    (method) => {
      expect(rolesFor(method)).toContain('admin');
      expect(rolesFor(method)).toContain('teacher');
    },
  );

  it('still refuses a student on every grading action', () => {
    for (const method of ['createTeacherRevision', 'publishResult', 'unpublishResult'] as const) {
      expect(rolesFor(method)).not.toContain('student');
    }
  });
});
