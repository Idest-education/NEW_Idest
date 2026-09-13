"use client";

import { use } from "react";
import Link from "next/link";
import { type SubmissionFull, getSubmission } from "../../../../lib/idest";
import { useResource } from "../../../../lib/use-api";
import { Notice, Shell, WaitingRack, board as s } from "../../../../components/board";
import { Sheet } from "../../../../components/review-sheet";

export default function ReviewSheet({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, state, error, reload } = useResource<SubmissionFull>(
    (token) => getSubmission<SubmissionFull>(id, token),
    [id],
  );

  return (
    <Shell role="teacher" wide>
      {state === "loading" ? <WaitingRack rows={2} /> : null}
      {state === "error" ? (
        <>
          <Notice tone="alert">{error}</Notice>
          <Link href="/teacher" className={s.pressQuiet} style={{ marginTop: "1rem" }}>
            Về bảng chấm
          </Link>
        </>
      ) : null}
      {state === "ready" && data ? <Sheet submission={data} onChanged={reload} /> : null}
    </Shell>
  );
}
