"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { recordReviewSessionQuietly } from "./idest";

/**
 * Records, once per submission, that the teacher opened this sheet for review.
 *
 * Nothing is awaited by the render path and nothing is returned, so the sheet
 * paints at exactly the same speed whether or not the server is reachable. The
 * ref guard stops a re-render firing a second request; a genuine remount or the
 * development double-effect costs one extra call, which the server's
 * thirty-minute deduplication window absorbs.
 */
export function useReviewSession(submissionId: string): void {
  const { getToken, isLoaded } = useAuth();
  const sent = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    if (sent.current === submissionId) return;
    sent.current = submissionId;

    void (async () => {
      try {
        const token = await getToken();
        await recordReviewSessionQuietly(token, submissionId);
      } catch {
        // Telemetry only. A token that cannot be minted is not the teacher's
        // problem and must never reach the screen.
      }
    })();
  }, [getToken, isLoaded, submissionId]);
}
