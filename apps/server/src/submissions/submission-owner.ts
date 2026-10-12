/**
 * The teacher who controls a submission: the assignment's teacher for the
 * class workflow, otherwise the teacher who graded it through the tool.
 * Null for an anonymous public submission, which no teacher may manage.
 */
export function submissionOwnerId(s: {
  ownerId: string | null;
  assignment?: { teacherId: string } | null;
}): string | null {
  return s.assignment?.teacherId ?? s.ownerId;
}
