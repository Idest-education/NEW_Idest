import { describe, expect, it } from 'vitest';
import { ROLES, USER_STATUSES, isRole } from './index.js';

describe('auth-contract', () => {
  it('declares the three roles and three statuses', () => {
    expect([...ROLES]).toEqual(['student', 'teacher', 'admin']);
    expect([...USER_STATUSES]).toEqual(['active', 'suspended', 'deleted']);
  });

  it('isRole accepts every declared role', () => {
    for (const role of ROLES) {
      expect(isRole(role)).toBe(true);
    }
  });

  it('isRole rejects unknown strings and non-strings', () => {
    expect(isRole('superuser')).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isRole(42)).toBe(false);
  });
});
