import type { Role } from "@repo/auth-contract";

const PUBLIC_PATHS: RegExp[] = [
  /^\/$/,
  /^\/sign-in(?:\/.*)?$/,
  /^\/sign-up(?:\/.*)?$/,
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((re) => re.test(pathname));
}

export function roleRedirectTarget(
  pathname: string,
  role: Role | undefined,
): string | null {
  if (pathname.startsWith("/teacher") && role !== "teacher") return "/";
  if (pathname.startsWith("/student") && role !== "student") return "/";
  return null;
}
