"use client";

import { use } from "react";
import Link from "next/link";
import { type SubmissionStudent, getSubmission } from "../../../../lib/idest";
import { useResource, usePolling } from "../../../../lib/use-api";
import { Notice, Shell, WaitingRack, board as s } from "../../../../components/board";
import { StudentSheet } from "../../../../components/student-sheet";

export default function StudentResult({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, state, error, reload } = useResource<SubmissionStudent>(
    (token) => getSubmission<SubmissionStudent>(id, token),
    [id],
  );

  // A strip still moving through the bays seats itself without a manual reload.
  // A failed run cannot advance on its own, so nothing is gained by polling it.
  usePolling(
    state === "ready" && data?.status !== "published" && data?.status !== "failed",
    reload,
    8000,
  );

  return (
    <Shell role="student">
      {state === "loading" ? <WaitingRack rows={2} /> : null}
      {state === "error" ? (
        <>
          <Notice tone="alert">{error}</Notice>
          <Link href="/student" className={s.pressQuiet} style={{ marginTop: "1rem" }}>
            Về bài viết của bạn
          </Link>
        </>
      ) : null}

      {state === "ready" && data ? <StudentSheet submission={data} /> : null}
    </Shell>
  );
}
