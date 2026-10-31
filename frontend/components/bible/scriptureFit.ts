'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// useLayoutEffect warns during SSR; fall back to useEffect on the server.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/** Binary-search the largest font size at which `textRef` still fits inside
 *  `areaRef`. Unlike an area/character estimate this accounts for real line
 *  wrapping, so each panel genuinely fills its own box — a short English verse
 *  scales up while a long Malayalam one stays within its bounds.
 *
 *  Attach areaRef to the fixed-size container and textRef to the content;
 *  size children in `em` so they scale with the returned size. */
export function useFitText(
  deps: React.DependencyList,
  opts?: { min?: number; maxFactor?: number; comfort?: number }
) {
  const areaRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [fontSize, setFontSize] = useState(24);
  // Text stays hidden until it has been fitted with its real web font, so the
  // screen never shows a fallback-font or mis-sized frame.
  const [ready, setReady] = useState(false);
  // Bumped on every fit so the reveal effect re-runs even when ready/fontSize
  // didn't change (e.g. a freshly remounted text element).
  const [revealGen, setRevealGen] = useState(0);
  const min = opts?.min ?? 8;
  const maxFactor = opts?.maxFactor ?? 0.45; // ceiling as a fraction of box height
  // Back off slightly from the absolute maximum so text doesn't crowd the edges.
  const comfort = opts?.comfort ?? 1;

  useIsomorphicLayoutEffect(() => {
    const area = areaRef.current;
    const text = textRef.current;
    if (!area || !text) return;

    const refit = () => {
      const availH = area.clientHeight;
      const availW = area.clientWidth;
      if (availH <= 0 || availW <= 0) return;
      const prev = text.style.fontSize;
      const fits = (px: number) => {
        text.style.fontSize = `${px}px`;
        return text.scrollHeight <= availH && text.scrollWidth <= availW;
      };
      let lo = min;
      let hi = Math.max(min, availH * maxFactor);
      if (fits(hi)) {
        lo = hi;
      } else {
        for (let i = 0; i < 14 && hi - lo > 0.5; i++) {
          const mid = (lo + hi) / 2;
          if (fits(mid)) lo = mid;
          else hi = mid;
        }
      }
      text.style.fontSize = prev;
      setFontSize(Math.max(min, Math.floor(lo * comfort * 10) / 10));
    };

    // Measuring before the Indic font arrives fits the fallback glyphs, which
    // are a different size (and break Malayalam conjuncts). Wait for the
    // fonts this text needs, then fit and reveal after the fitted size commits.
    let cancelled = false;
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    const spec = `16px ${getComputedStyle(text).fontFamily}`;
    const sample = text.textContent || '';
    if (!fonts || fonts.check(spec, sample)) {
      refit();
      setReady(true);
      setRevealGen((g) => g + 1);
    } else {
      // Hide imperatively right now: if ready was already false, setReady is a
      // no-op and the reveal effect wouldn't run to hide this (new) content.
      text.style.visibility = 'hidden';
      setReady(false);
      fonts.load(spec, sample).catch(() => {}).then(() => {
        if (cancelled) return;
        refit();
        setReady(true);
        setRevealGen((g) => g + 1);
      });
    }

    // Any later font swap changes the text's metrics, not the box's, so the
    // ResizeObserver alone would miss it.
    fonts?.addEventListener('loadingdone', refit);
    const ro = new ResizeObserver(refit);
    ro.observe(area);
    return () => {
      cancelled = true;
      fonts?.removeEventListener('loadingdone', refit);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Runs after the fitted size has committed, so the reveal never shows the
  // previous size for a frame. revealGen guarantees it runs after every fit.
  useIsomorphicLayoutEffect(() => {
    if (textRef.current) textRef.current.style.visibility = ready ? '' : 'hidden';
  }, [ready, fontSize, revealGen]);

  return { areaRef, textRef, fontSize };
}
