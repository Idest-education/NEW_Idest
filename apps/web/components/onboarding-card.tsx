"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { getOnboarding, setOnboardingDismissed, type OnboardingStatus } from "../lib/idest";
import { TOUR_STEP_COUNT, checklistRows, doneCount } from "../lib/tour";
import { useAction, useResource } from "../lib/use-api";
import { Notice, board as s } from "./board";
import o from "./onboarding.module.css";

/**
 * New-teacher checklist on the dashboard. Renders nothing while loading and
 * nothing on error: it is an aid, never a gate in front of the board.
 */
export function OnboardingCard() {
  const { data, state, setData } = useResource<OnboardingStatus>((token) => getOnboarding(token));
  const { busy, error, run } = useAction();

  if (state !== "ready" || !data || data.dismissedAt !== null) return null;

  const rows = checklistRows(data);
  const done = doneCount(data);
  const complete = done === TOUR_STEP_COUNT;

  const hide = async () => {
    const next = await run((token) => setOnboardingDismissed(token, true));
    if (next) setData(next);
  };

  return (
    <section className={o.card} aria-labelledby="onboarding-title">
      <div className={o.head}>
        <h2 id="onboarding-title" className={o.title}>
          {complete ? "Bạn đã nắm các bước cơ bản" : "Hãy tập làm quen với Idest!"}
        </h2>
        <span className={o.count} aria-label={`Đã xong ${done} trên ${TOUR_STEP_COUNT} bước`}>
          {done}/{TOUR_STEP_COUNT}
        </span>
      </div>

      <ol className={o.list}>
        {rows.map((row) => (
          <li key={row.key} className={row.done ? `${o.row} ${o.rowDone}` : o.row}>
            <span className={o.mark} aria-hidden="true">
              {row.done ? "✓" : "○"}
            </span>
            <span className={o.rowBody}>
              <span className={o.rowTitle}>
                {row.title}
                <span className={o.srOnly}>{row.done ? " (đã xong)" : " (chưa làm)"}</span>
              </span>
              <span className={o.rowHint}>{row.hint}</span>
            </span>
            <span className={o.actions}>
              {row.actions.map((action) =>
                action.href ? (
                  <Link
                    key={action.tour}
                    href={action.href}
                    className={action.primary ? s.press : s.pressQuiet}
                  >
                    {action.label}
                  </Link>
                ) : (
                  <span key={action.tour} className={o.blocked}>
                    {action.blockedReason}
                  </span>
                ),
              )}
            </span>
          </li>
        ))}
      </ol>

      {error ? <Notice tone="alert">{error}</Notice> : null}

      <div className={o.foot}>
        <button type="button" className={complete ? s.press : s.pressQuiet} disabled={busy} onClick={hide}>
          {busy ? "Đang ẩn…" : "Ẩn hướng dẫn"}
        </button>
      </div>
    </section>
  );
}

/** Help-page entry that brings the checklist card back for a teacher who hid it. */
export function OnboardingReplay() {
  const router = useRouter();
  const { busy, error, run } = useAction();

  const replay = async () => {
    const next = await run((token) => setOnboardingDismissed(token, false));
    if (next) router.push("/teacher");
  };

  return (
    <section className={o.replay} aria-labelledby="onboarding-replay-title">
      <div className={o.replayText}>
        <h2 id="onboarding-replay-title" className={s.sectionTitle}>
          Hướng dẫn bắt đầu
        </h2>
        <p className={s.fieldHint}>
          Năm bước đầu tiên: tạo lớp, mời học viên, tạo liên kết mời, giao bài tập và mở bài tập.
        </p>
      </div>
      <button type="button" className={s.pressQuiet} disabled={busy} onClick={replay}>
        {busy ? "Đang mở…" : "Xem lại hướng dẫn bắt đầu"}
      </button>
      {error ? <Notice tone="alert">{error}</Notice> : null}
    </section>
  );
}
