import type { Role, UserStatus } from "@repo/auth-contract";

export interface Profile {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  createdAt: string;
}

export const MAX_DISPLAY_NAME = 100;

/**
 * Client-side guard mirroring the server's `UpdateProfileDto` rules. Returns an
 * error message when the value is unacceptable, or `null` when it is fine.
 */
export function validateDisplayName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "Tên hiển thị không được để trống.";
  if (trimmed.length > MAX_DISPLAY_NAME) {
    return `Tên hiển thị tối đa ${MAX_DISPLAY_NAME} ký tự.`;
  }
  return null;
}
