import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { Role } from "./lib/api";
import { decide } from "./lib/access";

export default clerkMiddleware(async (auth, req) => {
  const { userId, sessionClaims, redirectToSignIn } = await auth();
  const role = (sessionClaims?.metadata as { role?: Role } | undefined)?.role;
  const decision = decide(req.nextUrl.pathname, Boolean(userId), role);
  if (decision === "sign-in") return redirectToSignIn();
  if (decision === "home") return NextResponse.redirect(new URL("/", req.url));
});

export const config = {
  // Clerk's recommended matcher: skip Next internals and static files.
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/"],
};
