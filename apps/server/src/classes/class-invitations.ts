import type { Prisma } from '@prisma/client';

/** Where-clause fragment for an invite that is neither accepted nor cancelled. */
export const PENDING = { acceptedAt: null, cancelledAt: null } as const;

/**
 * Seats a brand-new student in every class still holding an invite for their
 * email. Runs inside the user-creation transaction, so a failure here also
 * rolls back the user row. Kept free of Nest DI so the auth module can call it
 * without importing the classes module (which imports auth).
 */
export async function acceptPendingInvitations(
  tx: Prisma.TransactionClient,
  student: { id: string; email: string },
): Promise<number> {
  const email = student.email.toLowerCase();
  if (!email) return 0;

  const pending = await tx.classInvitation.findMany({
    where: { email, ...PENDING, class: { deletedAt: null } },
    select: { id: true, classId: true },
  });

  const now = new Date();
  for (const invite of pending) {
    await tx.classMember.upsert({
      where: { classId_studentId: { classId: invite.classId, studentId: student.id } },
      create: { classId: invite.classId, studentId: student.id },
      update: {},
    });
    await tx.classInvitation.update({
      where: { id: invite.id },
      data: { acceptedAt: now, acceptedUserId: student.id, pendingEmail: null },
    });
    await tx.auditEvent.create({
      data: {
        actorId: student.id,
        eventType: 'class.invitation_accepted',
        entityType: 'class',
        entityId: invite.classId,
        metadata: { invitationId: invite.id },
      },
    });
  }
  return pending.length;
}
