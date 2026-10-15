import { useEffect, useState } from "react";

export async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || JSON.stringify(data));
  return data as T;
}

export const esc = (s: unknown): string =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

/** Bryntum ships trial UMD builds; express serves them at /vendor/*.
 *  React waits for the script tag and then uses the global namespaces. */
export function useScript(src: string, globalCheck: () => boolean): boolean {
  const [ready, setReady] = useState<boolean>(() => {
    try {
      return globalCheck();
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (ready) return;
    let existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (!existing) {
      existing = document.createElement("script");
      existing.src = src;
      existing.async = true;
      document.head.appendChild(existing);
    }
    existing.addEventListener("load", () => setReady(true));
    // poll: the global may already exist or arrive with the load event missed
    const timer = setInterval(() => {
      if (globalCheck()) {
        setReady(true);
        clearInterval(timer);
      }
    }, 120);
    const stop = setTimeout(() => clearInterval(timer), 20_000);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [ready, src]);
  return ready;
}

/** debounce-free interval hook for statuslines / SSE-less polling */
export function useInterval(fn: () => void, ms: number) {
  useEffect(() => {
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  }, [ms]);
}
