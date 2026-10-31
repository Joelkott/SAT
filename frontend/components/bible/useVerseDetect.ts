'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { verseDetectApi, VerseDetection, VerseDetectStatus } from '@/lib/api';

// Media-only long-poll of /api/verse-detect/suggestions: keeps the detector
// status fresh and surfaces the newest detection the operator hasn't already
// dismissed or sent. Stops quietly on 403/404 (wrong role / older backend).

export interface ActiveDetection extends VerseDetection {
  expiresAt: number; // Date.now()-based
}

export interface VerseDetectState {
  available: boolean; // endpoint answered at least once (false on 403/404 -> render nothing)
  status: VerseDetectStatus | null;
  detection: ActiveDetection | null; // newest not-dismissed, not-expired
  setEnabled: (on: boolean) => Promise<void>; // optimistic; reverts + console.error on failure
  dismiss: (id: number) => void;
}

const POLL_WAIT_S = 20;
const DETECTION_TTL_MS = 90000;
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 15000;
const MIN_POLL_GAP_MS = 1000; // guards a tight loop if the server answers instantly with no change
const HANDLED_KEY = 'verse-detect-handled';
const HANDLED_KEEP = 50;

// Resolves after ms, or early when the signal aborts.
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
  });
}

function loadHandled(): number[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(HANDLED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'number').slice(-HANDLED_KEEP) : [];
  } catch {
    return [];
  }
}

function saveHandled(ids: number[]): void {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem(HANDLED_KEY, JSON.stringify(ids.slice(-HANDLED_KEEP))); } catch {}
}

export default function useVerseDetect(active: boolean): VerseDetectState {
  const [available, setAvailable] = useState(false);
  const [status, setStatus] = useState<VerseDetectStatus | null>(null);
  const [detection, setDetection] = useState<ActiveDetection | null>(null);

  const handledRef = useRef<number[] | null>(null);
  const statusRef = useRef<VerseDetectStatus | null>(null);
  const detectionRef = useRef<ActiveDetection | null>(null);

  const getHandled = useCallback((): number[] => {
    if (handledRef.current === null) handledRef.current = loadHandled();
    return handledRef.current;
  }, []);

  const showDetection = useCallback((d: ActiveDetection | null) => {
    detectionRef.current = d;
    setDetection(d);
  }, []);

  const applyStatus = useCallback((s: VerseDetectStatus) => {
    statusRef.current = s;
    setStatus(s);
    if (!s.enabled && detectionRef.current) showDetection(null);
  }, [showDetection]);

  const applyDetections = useCallback((list: VerseDetection[]) => {
    if (!statusRef.current?.enabled) return;
    const handled = getHandled();
    const now = Date.now();
    let newest: ActiveDetection | null = null;
    for (const d of list) {
      if (handled.includes(d.id)) continue;
      const expiresAt = now + Math.max(0, DETECTION_TTL_MS - (d.age_ms || 0));
      if (expiresAt <= now) continue;
      if (!newest || d.id > newest.id) newest = { ...d, expiresAt };
    }
    if (!newest) return;
    const current = detectionRef.current;
    if (current && current.id >= newest.id) return;
    showDetection(newest);
  }, [getHandled, showDetection]);

  // Long-poll loop. Depends only on `active`; everything else goes through refs.
  useEffect(() => {
    if (!active) {
      setAvailable(false);
      showDetection(null);
      return;
    }
    const ac = new AbortController();
    const signal = ac.signal;

    (async () => {
      let since = -1;
      let wait = 0;
      let failures = 0;
      let warned = false;
      while (!signal.aborted) {
        const started = Date.now();
        try {
          const res = await verseDetectApi.poll(since, wait, signal);
          if (signal.aborted) break;
          const unchanged = res.version === since;
          since = res.version;
          wait = POLL_WAIT_S;
          failures = 0;
          warned = false;
          setAvailable(true);
          if (res.status) applyStatus(res.status);
          applyDetections(res.detections ?? []);
          if (unchanged && Date.now() - started < MIN_POLL_GAP_MS) {
            await sleep(MIN_POLL_GAP_MS, signal);
          }
        } catch (err: any) {
          if (signal.aborted) break;
          const code = err?.response?.status;
          if (code === 403 || code === 404) {
            // Not media/admin, or the backend has no verse detection: stop quietly.
            setAvailable(false);
            showDetection(null);
            break;
          }
          if (!warned) {
            console.warn('Verse detection poll failed; retrying with backoff', {
              status: code,
              message: err?.message,
            });
            warned = true;
          }
          const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** failures);
          failures++;
          await sleep(delay, signal);
        }
      }
    })();

    return () => ac.abort();
  }, [active, applyDetections, applyStatus, showDetection]);

  // Expire the shown banner 90s after detection.
  useEffect(() => {
    if (!detection) return;
    const t = setInterval(() => {
      const d = detectionRef.current;
      if (d && Date.now() > d.expiresAt) showDetection(null);
    }, 1000);
    return () => clearInterval(t);
  }, [detection, showDetection]);

  const dismiss = useCallback((id: number) => {
    const handled = getHandled();
    if (!handled.includes(id)) {
      handled.push(id);
      if (handled.length > HANDLED_KEEP) handled.splice(0, handled.length - HANDLED_KEEP);
      saveHandled(handled);
    }
    if (detectionRef.current?.id === id) showDetection(null);
  }, [getHandled, showDetection]);

  const setEnabled = useCallback(async (on: boolean) => {
    const prev = statusRef.current;
    if (prev) applyStatus({ ...prev, enabled: on });
    try {
      const next = await verseDetectApi.setEnabled(on);
      applyStatus(next);
    } catch (error) {
      console.error('Failed to toggle verse detection:', error);
      if (prev) applyStatus(prev);
    }
  }, [applyStatus]);

  return {
    available: active && available,
    status: active ? status : null,
    detection: active ? detection : null,
    setEnabled,
    dismiss,
  };
}
