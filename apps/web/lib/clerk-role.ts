import { clerkClient } from "@clerk/nextjs/server";
import { isRole, type Role } from "@repo/auth-contract";

/**
 * Reads the role straight off the Clerk user record.
 *
 * Only for the window where the session JWT has no role claim yet (a
 * just-created account): the Backend API sees the write our server made, while
 * the already-minted token does not. Never call this on the steady-state path —
 * it is one extra API round trip per request.
 */
export async function fetchRoleFromClerk(userId: string): Promise<Role | undefined> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const role = (user.publicMetadata as { role?: unknown } | undefined)?.role;
    return isRole(role) ? role : undefined;
  } catch {
    return undefined;
  }
}
