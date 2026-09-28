"use client";

import Link from "next/link";
import { getFeedback, type FeedbackState } from "../lib/idest";
import { bannerVisible } from "../lib/feedback";
import { useResource } from "../lib/use-api";
import styles from "./feedback-banner.module.css";

/** Survey invitation on the teacher and student dashboards; gone once they have answered. */
export function FeedbackBanner() {
  const { data, state } = useResource<FeedbackState>((token) => getFeedback(token));
  if (!bannerVisible(state === "ready" ? data : null)) return null;

  return (
    <Link href="/feedback" className={styles.banner}>
      <span>Nếu có thời gian, bạn hãy giúp chúng tớ điền khảo sát nhé</span>
      <span className={styles.arrow} aria-hidden="true">
        →
      </span>
    </Link>
  );
}
