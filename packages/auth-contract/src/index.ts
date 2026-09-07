export const ROLES = ['student', 'teacher', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ['active', 'suspended', 'deleted'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface ClerkPublicMetadata {
  role?: Role;
  /** Inviting teacher's Clerk user id, set on student invitations. */
  invitedBy?: string;
}

export interface SessionMetadataClaim {
  role?: Role;
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
