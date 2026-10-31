'use client';

import { useEffect, useState } from 'react';

// Keep the phone screen on while the viewer is open. The browser drops the lock
// whenever the page is hidden, so it is re-requested when the page becomes
// visible again. All errors are swallowed (low battery, unsupported, denied).
export function useWakeLock(active: boolean): { supported: boolean } {
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    const has = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
    setSupported(has);
    if (!active || !has) return;

    let sentinel: any = null;
    let cancelled = false;

    const request = async () => {
      try {
        const s = await (navigator as any).wakeLock.request('screen');
        if (cancelled) {
          s.release().catch(() => {});
          return;
        }
        sentinel = s;
      } catch {
        // Not allowed right now (e.g. hidden tab, battery saver) — ignore.
      }
    };

    const onVis = () => {
      if (document.visibilityState === 'visible') request();
    };

    request();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      if (sentinel) {
        sentinel.release().catch(() => {});
        sentinel = null;
      }
    };
  }, [active]);

  return { supported };
}
