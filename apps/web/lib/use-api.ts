"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";
import { createApi, describeError, type Api } from "./api";

export function useApi(): Api {
  const { getToken } = useAuth();
  return useMemo(() => createApi(() => getToken()), [getToken]);
}

/**
 * Loads `key`'s data and, while `pollWhile(data)` holds, loads it again every
 * `pollMs`. A null key loads nothing. A failed poll backs off and tries again.
 */
export function useLoad<T>(
  key: string | null,
  load: () => Promise<T>,
  pollWhile?: (data: T) => boolean,
  pollMs = 3000,
) {
  const [state, setState] = useState<{ key: string | null; data?: T; error?: string }>({ key: null });
  const [version, setVersion] = useState(0);
  const run = useEffectEvent(load);
  const keepPolling = useEffectEvent((data: T) => pollWhile?.(data) ?? false);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastData: T | undefined;
    const tick = async () => {
      try {
        const data = await run();
        if (cancelled) return;
        lastData = data;
        setState({ key, data });
        if (keepPolling(data)) timer = setTimeout(tick, pollMs);
      } catch (err) {
        if (cancelled) return;
        setState({ key, data: lastData, error: describeError(err) });
        if (lastData !== undefined && keepPolling(lastData)) timer = setTimeout(tick, pollMs * 3);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, version, pollMs]);

  const current = state.key === key ? state : { key, data: undefined, error: undefined };
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data: current.data, error: current.error, loading: !current.data && !current.error, reload };
}
