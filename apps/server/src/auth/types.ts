export interface RequestAuth {
  clerkUserId: string;
  sessionId: string;
  claims: Record<string, unknown>;
}
