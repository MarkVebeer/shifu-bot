import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

export interface ApiState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (data: T) => void;
}

/** Fetch JSON from the API and keep it in state. Pass null to skip. */
export function useApi<T>(path: string | null): ApiState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(path !== null);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (path === null) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    setError(undefined);
    try {
      setData(await api<T>(path, { signal: current.signal }));
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError(err);
    } finally {
      if (controller.current === current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}
