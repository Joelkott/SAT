'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

/**
 * Per-song scroll memory.
 *
 * Lyric panes are plain `overflow-y-auto` boxes, so which section is on screen
 * (Verse 1 vs the Chorus) is nothing more than the box's scrollTop. Without help
 * that offset either leaks into the next song (same DOM node reused, then
 * clamped by the shorter song) or is wiped to 0 (node remounted), so coming
 * back to a song never lands where it was left.
 *
 * This hook remembers the offset of each scroll box against a caller-supplied
 * key (the song), restores it before the browser paints the new song, and
 * starts a never-seen song at the top.
 *
 * Positions are stored as a fraction of the scrollable range rather than as
 * pixels: zoom, line spacing and font changes all move the pixel offset of a
 * given line, but the fraction keeps pointing at roughly the same place. When
 * nothing has changed the fraction round-trips to the exact original pixel.
 */

// Layout effects keep the restore ahead of the paint so the wrong verse never
// flashes on the projector. useLayoutEffect warns during SSR, hence the swap.
export const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

function read(key: string): number[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((n) => (typeof n === 'number' && n >= 0 && n <= 1 ? n : 0));
  } catch {
    return [];
  }
}

function write(key: string, ratios: number[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ratios.map((r) => Number(r.toFixed(4)))));
  } catch {}
}

export interface ScrollMemory {
  /** ref callback for scroll box `index` */
  paneRef: (index: number) => (el: HTMLElement | null) => void;
  /** onScroll handler for scroll box `index` */
  onPaneScroll: (index: number) => (e: { currentTarget: HTMLElement }) => void;
  /** re-apply the remembered offsets (e.g. after the layout changes) */
  restore: () => void;
}

/**
 * @param storageKey full localStorage key for the current song, or undefined to
 *                   disable persistence (no song / no id).
 */
export function useScrollMemory(storageKey: string | undefined): ScrollMemory {
  const elements = useRef<Array<HTMLElement | null>>([]);
  const ratios = useRef<number[]>([]);
  // A programmatic scrollTop (and the browser's own clamping when shorter
  // lyrics load) fires scroll events. Saving those would immediately overwrite
  // the position we are in the middle of restoring.
  const suppress = useRef(false);
  const appliedKey = useRef<string | undefined>(undefined);
  const refCbs = useRef(new Map<number, (el: HTMLElement | null) => void>());
  const scrollCbs = useRef(new Map<number, (e: { currentTarget: HTMLElement }) => void>());

  const frames = useRef<number[]>([]);
  const timer = useRef<number | null>(null);

  const cancelPending = useCallback(() => {
    frames.current.forEach(cancelAnimationFrame);
    frames.current = [];
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const apply = useCallback(() => {
    elements.current.forEach((el, i) => {
      if (!el) return;
      const max = el.scrollHeight - el.clientHeight;
      el.scrollTop = max > 0 ? Math.min(max, (ratios.current[i] || 0) * max) : 0;
    });
  }, []);

  // Callers invoke this from a layout effect, so the offsets land on the newly
  // committed scroll boxes before the browser paints. The follow-up frames are
  // only a safety net for content that settles late — correctness must not
  // depend on them (rAF is throttled while a window is hidden or idle).
  const restore = useCallback(() => {
    cancelPending();
    suppress.current = true;
    apply();
    frames.current.push(
      requestAnimationFrame(() => {
        apply();
        frames.current.push(
          requestAnimationFrame(() => { suppress.current = false; })
        );
      })
    );
    // Don't let a throttled rAF strand saving in the off position.
    timer.current = window.setTimeout(() => { suppress.current = false; }, 500);
  }, [apply, cancelPending]);

  useIsomorphicLayoutEffect(() => {
    if (appliedKey.current === storageKey) return;
    appliedKey.current = storageKey;
    ratios.current = storageKey ? read(storageKey) : [];
    restore();
  }, [storageKey, restore]);

  // Never leave saving switched off behind us.
  useEffect(() => () => {
    cancelPending();
    suppress.current = false;
  }, [cancelPending]);

  const paneRef = useCallback((index: number) => {
    let cb = refCbs.current.get(index);
    if (!cb) {
      cb = (el: HTMLElement | null) => {
        elements.current[index] = el;
      };
      refCbs.current.set(index, cb);
    }
    return cb;
  }, []);

  const onPaneScroll = useCallback((index: number) => {
    let cb = scrollCbs.current.get(index);
    if (!cb) {
      cb = (e: { currentTarget: HTMLElement }) => {
        if (suppress.current) return;
        const el = e.currentTarget;
        const max = el.scrollHeight - el.clientHeight;
        ratios.current[index] = max > 0 ? el.scrollTop / max : 0;
        // Written straight away (the payload is a few bytes) so the offset is
        // already on disk when the operator switches song mid-scroll, and is
        // always filed under the song that was actually on screen.
        const key = appliedKey.current;
        if (key) write(key, ratios.current);
      };
      scrollCbs.current.set(index, cb);
    }
    return cb;
  }, []);

  // Stable identity so callers can list it as an effect dependency.
  return useMemo(() => ({ paneRef, onPaneScroll, restore }), [paneRef, onPaneScroll, restore]);
}
