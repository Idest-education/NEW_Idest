"use client";

import { use, useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ReasonPrompt,
  type SubmissionFull,
  type UntaggedRevision,
  getSubmission,
  listUntaggedRevisions,
} from "../../../../lib/idest";
import { useResource } from "../../../../lib/use-api";
import { useReviewSession } from "../../../../lib/use-review-session";
import { Notice, Shell, WaitingRack, board as s } from "../../../../components/board";
import { Sheet } from "../../../../components/review-sheet";
import { ReasonBatchModal } from "../../../../components/reason-batch-modal";

const BOARD_HREF = "/teacher";

export default function ReviewSheet({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const { data, state, error, reload } = useResource<SubmissionFull>(
    (token) => getSubmission<SubmissionFull>(id, token),
    [id],
  );

  // Starts the review-duration sample. Fire-and-forget: it neither delays this
  // render nor can it put an error on screen.
  useReviewSession(id);

  const assignmentId = data?.assignmentId ?? null;
  const { data: untagged, reload: reloadUntagged } = useResource<UntaggedRevision[]>(
    (token) => (assignmentId ? listUntaggedRevisions(assignmentId, token) : Promise.resolve([])),
    [assignmentId],
  );
  const untaggedRows = untagged ?? [];

  const [reasonOpen, setReasonOpen] = useState(false);
  // Where the teacher was heading when we stopped them. Null means they opened
  // the modal from the prompt and are staying on the page.
  const leavingTo = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    await reload();
    await reloadUntagged();
  }, [reload, reloadUntagged]);

  const handlePrompt = useCallback((prompt: ReasonPrompt) => {
    if (prompt.shouldPrompt) setReasonOpen(true);
  }, []);

  const closeReason = useCallback(() => {
    setReasonOpen(false);
    const target = leavingTo.current;
    leavingTo.current = null;
    if (target) router.push(target);
  }, [router]);

  return (
    <Shell role="teacher" wide>
      {state === "loading" ? <WaitingRack rows={2} /> : null}
      {state === "error" ? (
        <>
          <Notice tone="alert">{error}</Notice>
          <Link href={BOARD_HREF} className={s.pressQuiet} style={{ marginTop: "1rem" }}>
            Về bảng chấm
          </Link>
        </>
      ) : null}
      {state === "ready" && data ? (
        <>
          <Sheet submission={data} onChanged={refresh} onReasonPrompt={handlePrompt} />
          <div className={s.actionRow}>
            <Link
              href={BOARD_HREF}
              className={s.pressQuiet}
              onNavigate={(event) => {
                // Last chance to collect reasons while they are still fresh.
                // Nothing here has been published or unpublished by leaving, so
                // cancelling the navigation costs the teacher one dismissal.
                if (untaggedRows.length === 0) return;
                event.preventDefault();
                leavingTo.current = BOARD_HREF;
                setReasonOpen(true);
              }}
            >
              ← Về bảng chấm
            </Link>
          </div>
        </>
      ) : null}

      <ReasonBatchModal
        open={reasonOpen}
        onClose={closeReason}
        revisions={untaggedRows}
        onTagged={refresh}
      />
    </Shell>
  );
}
