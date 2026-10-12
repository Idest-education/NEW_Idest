"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  execute: (id: string) => void;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** invisible: shown only if Cloudflare asks. visible: the checkbox, after one failure. failed: offer sign-in instead. */
export type TurnstileStage = "invisible" | "visible" | "failed";

/**
 * Cloudflare Turnstile, run on demand. `action` must match the one the server route expects. `token()` gives a fresh single-use token,
 * or undefined when the check is off (signed in, or no site key in local dev).
 * `fail()` records a rejected check: the first retry shows the visible widget, after that the caller offers sign-in,
 * since signed-in callers skip the check.
 */
export function useTurnstile(enabled: boolean, action: string) {
  const box = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);
  const waiting = useRef<((result: string | Error) => void) | null>(null);
  const [stage, setStage] = useState<TurnstileStage>("invisible");
  const on = enabled && Boolean(SITE_KEY);

  function fail(): TurnstileStage {
    const next = stage === "invisible" ? "visible" : "failed";
    // Drop the widget; the next token() renders it again with the new appearance.
    if (id.current) window.turnstile?.remove(id.current);
    id.current = null;
    setStage(next);
    return next;
  }

  const settle = (result: string | Error) => {
    waiting.current?.(result);
    waiting.current = null;
  };

  function mount() {
    if (!on || id.current || !box.current || !window.turnstile) return;
    id.current = window.turnstile.render(box.current, {
      sitekey: SITE_KEY,
      action,
      execution: "execute",
      appearance: stage === "invisible" ? "interaction-only" : "always",
      callback: (t: string) => settle(t),
      "error-callback": () => settle(new Error("captcha")),
    });
  }

  // The Script's onReady renders the widget; this only removes it.
  useEffect(
    () => () => {
      if (id.current) window.turnstile?.remove(id.current);
      id.current = null;
    },
    [on],
  );

  async function token(): Promise<string | undefined> {
    if (!on) return undefined;
    mount();
    const widget = id.current;
    const ts = window.turnstile;
    if (!widget || !ts) throw new Error("The security check is still loading. Try again in a moment.");
    return new Promise((resolve, reject) => {
      waiting.current = (r) => {
        if (typeof r === "string") return resolve(r);
        reject(new Error(captchaMessage(fail())));
      };
      // Tokens are single-use, so every call starts a new challenge.
      ts.reset(widget);
      ts.execute(widget);
    });
  }

  const widget = on ? (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" onReady={mount} />
      <div ref={box} />
    </>
  ) : null;

  return { token, widget, stage, fail };
}

export function captchaMessage(stage: TurnstileStage): string {
  return stage === "failed"
    ? "We still couldn't confirm you're human. Sign in to continue: signed-in accounts skip this check."
    : "We couldn't confirm you're human. Try again and complete the quick check that appears.";
}
