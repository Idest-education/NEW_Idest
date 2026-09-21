import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { Role } from "@repo/auth-contract";
import { fetchRoleFromClerk } from "./lib/clerk-role";
import { isPublicPath, roleGate } from "./lib/route-access";

export default clerkMiddleware(async (auth, req) => {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return;

  const { userId, sessionClaims, redirectToSignIn } = await auth();
  if (!userId) {
    return redirectToSignIn();
  }

  const role = (sessionClaims?.metadata as { role?: Role } | undefined)?.role;
  const gate = roleGate(pathname, role);
  if (gate.kind === "allow") return;
  if (gate.kind === "redirect") {
    return NextResponse.redirect(new URL(gate.to, req.url));
  }

  // No role claim in the token yet — the account was created moments ago and
  // its role reached Clerk after this session's token was minted. Ask Clerk
  // directly rather than bouncing the user to the landing page.
  const resolved = await fetchRoleFromClerk(userId);
  const settled = roleGate(pathname, resolved);
  if (settled.kind === "allow") return;
  if (settled.kind === "redirect") {
    return NextResponse.redirect(new URL(settled.to, req.url));
  }

  // Clerk has no role either: the mirror write failed or has not happened at
  // all. /welcome is never role-gated and re-runs the provisioning call that
  // sets it, so send them there instead of to a dead end.
  return NextResponse.redirect(new URL("/welcome", req.url));
});

export const config = {
  // Clerk's recommended matcher: skip Next internals and static files, always run for API routes.
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};
