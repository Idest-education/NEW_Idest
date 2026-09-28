-- CreateTable
CREATE TABLE "class_invitations" (
    "id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "pending_email" VARCHAR(320),
    "clerk_invitation_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ(6),
    "accepted_user_id" UUID,
    "cancelled_at" TIMESTAMPTZ(6),

    CONSTRAINT "class_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "class_invitations_pending_unique" ON "class_invitations"("class_id", "pending_email");

-- CreateIndex
CREATE INDEX "class_invitations_email_index" ON "class_invitations"("email");

-- CreateIndex
CREATE INDEX "class_invitations_class_id_index" ON "class_invitations"("class_id");

-- AddForeignKey
ALTER TABLE "class_invitations" ADD CONSTRAINT "class_invitations_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_invitations" ADD CONSTRAINT "class_invitations_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
