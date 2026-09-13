"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { ApiError } from "./idest";

export type LoadState = "loading" | "ready" | "error";

export function message(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return "Có lỗi không xác định. Thử lại giúp mình nhé.";
}

/**
 * Loads one API resource with the Clerk token attached, and re-runs on demand.
 * Keeps the last good data on screen while a reload is in flight.
 */
export function useResource<T>(
  load: (token: string | null) => Promise<T>,
  deps: unknown[] = [],
): {
  data: T | null;
  state: LoadState;
  error: string | null;
  reload: () => Promise<void>;
  setData: (next: T) => void;
} {
  const { getToken, isLoaded } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (!isLoaded) return;
    setError(null);
    try {
      const token = await getToken();
      const next = await loadRef.current(token);
      if (!alive.current) return;
      setData(next);
      setState("ready");
    } catch (err) {
      if (!alive.current) return;
      setError(message(err));
      setState("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getToken, isLoaded, ...deps]);

  useEffect(() => {
    void run();
  }, [run]);

  return { data, state, error, reload: run, setData };
}

/** Runs a mutation with the Clerk token, exposing a single in-flight flag. */
export function useAction(): {
  busy: boolean;
  error: string | null;
  setError: (value: string | null) => void;
  run: <T>(fn: (token: string | null) => Promise<T>) => Promise<T | undefined>;
} {
  const { getToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T,>(fn: (token: string | null) => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setError(null);
      try {
        return await fn(await getToken());
      } catch (err) {
        setError(message(err));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [getToken],
  );

  return { busy, error, setError, run };
}

/**
 * Polls while a submission is still moving through the scoring bays, so a
 * student watching their strip sees it seat without reloading the page.
 */
export function usePolling(active: boolean, tick: () => void, intervalMs = 5000): void {
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => tickRef.current(), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);
}
