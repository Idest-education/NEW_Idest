"use client";

import Link from "next/link";
import { getFeedback, type FeedbackState } from "../lib/idest";
import { SURVEY_MINUTES, bannerVisible } from "../lib/feedback";
import { useResource } from "../lib/use-api";
import styles from "./feedback-banner.module.css";

/** Survey invitation on the teacher and student dashboards; gone once they have answered. */
export function FeedbackBanner() {
  const { data, state } = useResource<FeedbackState>((token) => getFeedback(token));
  if (!data || !bannerVisible(state === "ready" ? data : null)) return null;

  return (
    <Link href="/feedback" className={styles.banner}>
      <span className={styles.icon} aria-hidden="true">
        ✎
      </span>
      <span className={styles.body}>
        <span className={styles.text}>Nếu có thời gian, bạn hãy giúp chúng tớ điền khảo sát nhé</span>
        <span className={styles.hint}>Chỉ khoảng {SURVEY_MINUTES[data.role]} phút · sửa lại được bất cứ lúc nào</span>
      </span>
      <span className={styles.cta}>
        Làm khảo sát
        <span className={styles.arrow} aria-hidden="true">
          →
        </span>
      </span>
    </Link>
  );
}
