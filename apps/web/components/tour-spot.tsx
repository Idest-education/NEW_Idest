"use client";

import { useCallback, useEffect, useId, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  TOUR_STEPS,
  TOUR_STEP_COUNT,
  isTourStepId,
  placeBubble,
  tourExitUrl,
  type Rect,
  type Size,
  type TourStepId,
} from "../lib/tour";
import board from "./board.module.css";
import styles from "./tour-spot.module.css";

/** How long a data-driven page gets to render the spotlight target. */
const FIND_TIMEOUT_MS = 4000;
/** Breathing room between the target's edge and the cut-out ring. */
const RING_PAD = 6;
const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
/** Used until the bubble has been measured once. */
const BUBBLE_FALLBACK: Size = { width: 352, height: 190 };

function subscribeViewport(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}
const viewportKey = () => `${window.innerWidth}x${window.innerHeight}`;
const serverViewportKey = () => "0x0";

type Phase = { kind: "searching" } | { kind: "found"; el: HTMLElement } | { kind: "missing" };

/**
 * Reads `?tour=<step>` and points at the matching `[data-tour]` element.
 * Mounted by `Shell` for teachers, inside a Suspense boundary.
 */
export function TourSpot() {
  const tour = useSearchParams().get("tour");
  if (!isTourStepId(tour)) return null;
  return <Spotlight key={tour} id={tour} />;
}

function Spotlight({ id }: { id: TourStepId }) {
  const pathname = usePathname();
  const step = TOUR_STEPS[id];
  const titleId = useId();
  const bodyId = useId();
  const [phase, setPhase] = useState<Phase>({ kind: "searching" });
  const [ended, setEnded] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [bubbleSize, setBubbleSize] = useState<Size>(BUBBLE_FALLBACK);
  const [vw, vh] = useSyncExternalStore(subscribeViewport, viewportKey, serverViewportKey)
    .split("x")
    .map(Number) as [number, number];

  // Hide at once, then drop `?tour=` through the native history API: Next
  // syncs useSearchParams from it without a server round-trip, so the page's
  // own handler (an opening wizard, say) is never covered or reloaded.
  const end = useCallback(() => {
    setEnded(true);
    window.history.replaceState(null, "", tourExitUrl(pathname, window.location.search));
  }, [pathname]);

  // Wait for the page to render the target; data-driven pages mount it late.
  useEffect(() => {
    const selector = `[data-tour="${id}"]`;
    let settled = false;
    let frame = 0;
    const observer = new MutationObserver(() => look());
    const timer = window.setTimeout(() => settle({ kind: "missing" }), FIND_TIMEOUT_MS);

    function settle(next: Phase) {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearTimeout(timer);
      setPhase(next);
    }

    function look() {
      const el = document.querySelector<HTMLElement>(selector);
      if (el) settle({ kind: "found", el });
    }

    observer.observe(document.body, { childList: true, subtree: true });
    frame = window.requestAnimationFrame(look);

    return () => {
      settled = true;
      observer.disconnect();
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
    };
  }, [id]);

  // Once found: bring it into view, hand it focus, and track where it sits.
  useEffect(() => {
    if (phase.kind !== "found") return;
    const el = phase.el;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });

    const focusTarget = el.matches(FOCUSABLE) ? el : el.querySelector<HTMLElement>(FOCUSABLE);
    const previousDescribedBy = focusTarget?.getAttribute("aria-describedby") ?? null;
    focusTarget?.setAttribute("aria-describedby", bodyId);
    focusTarget?.focus({ preventScroll: true });

    let frame = 0;
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (!el.isConnected) {
          // The page re-rendered and swapped the node: look again.
          const again = document.querySelector<HTMLElement>(`[data-tour="${id}"]`);
          setPhase(again ? { kind: "found", el: again } : { kind: "missing" });
          return;
        }
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      });
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    const resize = new ResizeObserver(measure);
    resize.observe(el);

    // Activating the real control ends the tour; typing in a field does not.
    const onClick = (event: MouseEvent) => {
      const hit = (event.target as Element | null)?.closest("button, a");
      if (hit && el.contains(hit)) end();
    };
    el.addEventListener("click", onClick);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      resize.disconnect();
      el.removeEventListener("click", onClick);
      if (previousDescribedBy === null) focusTarget?.removeAttribute("aria-describedby");
      else focusTarget?.setAttribute("aria-describedby", previousDescribedBy);
    };
  }, [phase, id, bodyId, end]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") end();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [end]);

  // Measure the bubble so placement flips and clamps with its real size.
  const measureBubble = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver(() => {
      setBubbleSize({ width: node.offsetWidth, height: node.offsetHeight });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (ended || phase.kind === "searching") return null;
  if (phase.kind === "found" && !rect) return null;

  const hole =
    phase.kind === "found" && rect
      ? {
          top: rect.top - RING_PAD,
          left: rect.left - RING_PAD,
          width: rect.width + RING_PAD * 2,
          height: rect.height + RING_PAD * 2,
        }
      : null;
  const place = placeBubble(hole, bubbleSize, { width: vw, height: vh });

  return (
    <>
      {hole ? (
        <div className={styles.layer} aria-hidden="true">
          <div className={styles.dim} style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }} onClick={end} />
          <div className={styles.dim} style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }} onClick={end} />
          <div
            className={styles.dim}
            style={{ top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height }}
            onClick={end}
          />
          <div
            className={styles.dim}
            style={{ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }}
            onClick={end}
          />
          <div className={styles.ring} style={hole} />
        </div>
      ) : null}

      <div
        ref={measureBubble}
        className={styles.bubble}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-placement={place.placement}
        style={{ top: place.top, left: place.left }}
      >
        <span className={styles.step}>
          Bước {step.step}/{TOUR_STEP_COUNT}
        </span>
        <h2 id={titleId} className={styles.title}>
          {step.title}
        </h2>
        <p id={bodyId} className={styles.body}>
          {step.body}
        </p>
        <div className={styles.actions}>
          <Link href="/teacher" className={styles.back}>
            ← Về hướng dẫn
          </Link>
          <button type="button" className={board.press} onClick={end}>
            Đã hiểu
          </button>
        </div>
      </div>
    </>
  );
}
