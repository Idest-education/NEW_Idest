/** Clerk's 422 for an email that already has an invitation or an account. */
export function isClerkAlreadyExists(err: unknown): boolean {
  const e = err as { status?: number; errors?: Array<{ code?: string }> };
  return (
    e?.status === 422 &&
    Boolean(
      e.errors?.some(
        (x) => x.code === 'duplicate_record' || x.code === 'form_identifier_exists',
      ),
    )
  );
}
