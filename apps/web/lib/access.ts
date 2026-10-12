// Which routes need what. The proxy and the client use this only to route;
// the server enforces every permission again.
import type { Role } from "./api";

export type Access = "public" | "signed-in" | "teacher" | "admin";

const RULES: [RegExp, Access][] = [
  [/^\/admin(\/|$)/, "admin"],
  [/^\/(history|batches|review)(\/|$)/, "teacher"],
  [/^\/(account|help)(\/|$)/, "signed-in"],
];

export function accessFor(pathname: string): Access {
  return RULES.find(([re]) => re.test(pathname))?.[1] ?? "public";
}

export function roleAllows(access: Access, role: Role): boolean {
  if (access === "admin") return role === "admin";
  if (access === "teacher") return role === "teacher" || role === "admin";
  return true;
}

export type Decision = "allow" | "sign-in" | "home" | "check-role";

/**
 * `check-role`: signed in, but the token has no role claim yet (a brand-new
 * account). Let the page through; it asks the server for the role instead.
 */
export function decide(pathname: string, signedIn: boolean, role: Role | undefined): Decision {
  const access = accessFor(pathname);
  if (access === "public") return "allow";
  if (!signedIn) return "sign-in";
  if (access === "signed-in") return "allow";
  if (!role) return "check-role";
  return roleAllows(access, role) ? "allow" : "home";
}
