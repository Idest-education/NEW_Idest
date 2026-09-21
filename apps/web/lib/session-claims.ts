import { isRole, type Role } from "@repo/auth-contract";

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Reads `metadata.role` out of a Clerk session JWT without verifying it. */
export function roleFromSessionToken(token: string | null | undefined): Role | undefined {
  if (!token) return undefined;
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(decodeBase64Url(payload)) as {
      metadata?: { role?: unknown };
    };
    const role = claims.metadata?.role;
    return isRole(role) ? role : undefined;
  } catch {
    return undefined;
  }
}

const defaultSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mints fresh session tokens until one actually carries a role claim.
 *
 * A new account's role is written to Clerk `publicMetadata` by our backend
 * after the sign-up token was minted, so the first uncached token can still
 * come back without it. Waiting here keeps the role-gated destination from
 * bouncing the user straight back to the landing page. Bounded: the caller
 * gets `undefined` rather than a hang if the claim never appears.
 */
export async function waitForRoleClaim(
  getToken: (options: { skipCache: true }) => Promise<string | null>,
  {
    attempts = 5,
    delayMs = 400,
    sleep = defaultSleep,
  }: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<unknown> } = {},
): Promise<Role | undefined> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(delayMs);
    try {
      const role = roleFromSessionToken(await getToken({ skipCache: true }));
      if (role) return role;
    } catch {
      // A failed refresh is just another attempt that produced no claim.
    }
  }
  return undefined;
}
