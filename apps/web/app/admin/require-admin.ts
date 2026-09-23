import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getProfile, type Profile } from "../../lib/idest";

/**
 * Server-side gate for every /admin page.
 *
 * apps/web/lib/route-access.ts only scopes /teacher and /student, so proxy.ts
 * lets any signed-in user reach /admin. This is what turns a non-admin away —
 * and the real protection is `@Roles('admin')` on the server's
 * AnalyticsController, which this cannot bypass.
 *
 * redirect() throws and is typed `never`, so it must never sit inside a `try`
 * body. Calling it from a `catch` is fine and is what lets `profile` be a
 * definitely-assigned `let`.
 */
export async function requireAdmin(): Promise<{ token: string; profile: Profile }> {
  const { userId, getToken } = await auth();
  if (!userId) redirect("/sign-in");

  const token = await getToken();
  if (!token) redirect("/sign-in");

  let profile: Profile;
  try {
    profile = await getProfile(token);
  } catch {
    redirect("/");
  }

  if (profile.role !== "admin") redirect("/");

  return { token, profile };
}
