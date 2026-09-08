import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { Role } from "@repo/auth-contract";
import { isPublicPath, roleRedirectTarget } from "./lib/route-access";

export default clerkMiddleware(async (auth, req) => {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return;

  const { userId, sessionClaims, redirectToSignIn } = await auth();
  if (!userId) {
    return redirectToSignIn();
  }

  const role = (sessionClaims?.metadata as { role?: Role } | undefined)?.role;
  const target = roleRedirectTarget(pathname, role);
  if (target) {
    return NextResponse.redirect(new URL(target, req.url));
  }
});

export const config = {
  // Clerk's recommended matcher: skip Next internals and static files, always run for API routes.
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};
