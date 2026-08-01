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

    refit();
    const ro = new ResizeObserver(refit);
    ro.observe(area);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { areaRef, textRef, fontSize };
}
