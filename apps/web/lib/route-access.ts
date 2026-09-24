import type { Role } from "@repo/auth-contract";

const PUBLIC_PATHS: RegExp[] = [
  /^\/$/,
  /^\/sign-in(?:\/.*)?$/,
  /^\/sign-up(?:\/.*)?$/,
  // An invite link must be viewable — and its own sign-in/sign-up steps
  // reachable — before the visitor has an account at all.
  /^\/join(?:\/.*)?$/,
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((re) => re.test(pathname));
}

/** Where a signed-in account belongs. */
export function homeForRole(role: Role | undefined): string {
  if (role === "teacher") return "/teacher";
  if (role === "student") return "/student";
  if (role === "admin") return "/admin";
  return "/";
}

export type RoleGate =
  | { kind: "allow" }
  | { kind: "redirect"; to: string }
  /** The caller must look the role up authoritatively before deciding. */
  | { kind: "resolve" };

/**
 * Decides a role-scoped route for the role carried by the session JWT.
 *
 * `role === undefined` is deliberately NOT treated as "wrong role": the claim is
 * missing for the first ~60s of a brand-new account, because the backend writes
 * `publicMetadata.role` only on the first authenticated API call — after the
 * sign-up token was minted. Redirecting those requests away stranded new users
 * on the landing page until their token happened to refresh, so the caller is
 * told to resolve the role from Clerk instead.
 */
export function roleGate(pathname: string, role: Role | undefined): RoleGate {
  const scope = pathname.startsWith("/teacher")
    ? "teacher"
    : pathname.startsWith("/student")
      ? "student"
      : null;
  if (!scope) return { kind: "allow" };
  if (role === scope) return { kind: "allow" };
  // Every teacher endpoint on the server carries @Roles('teacher', 'admin'), so
  // refusing an admin here would lock a promoted teacher out of the grading UI
  // while the API kept accepting them. The student workspace stays exclusive:
  // it shows one learner their own work and has no administrative purpose.
  if (role === "admin" && scope === "teacher") return { kind: "allow" };
  if (!role) return { kind: "resolve" };
  return { kind: "redirect", to: homeForRole(role) };
}
