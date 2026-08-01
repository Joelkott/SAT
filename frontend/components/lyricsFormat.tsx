'use client';

import { useEffect, useState } from 'react';
import { displayConfigApi } from '@/lib/api';

// Lyrics support one inline format: **bold**. Stored as plain text markers so
// the backend, search, and ProPresenter pipelines stay untouched.

const BOLD_RE = /(\*\*[^*][\s\S]*?\*\*)/g;

/** Render lyric text with **bold** segments as <strong>. */
export function FormattedLyrics({ text }: { text: string }) {
  const parts = text.split(BOLD_RE);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') && p.length > 4 ? (
          <strong key={i} className="font-bold">
            {p.slice(2, -2)}
          </strong>
        ) : (
          p
        )
      )}
    </>
  );
}

/** Remove bold markers (for snippets, search previews). */
export function stripBold(text: string): string {
  return text.replace(/\*\*([^*][\s\S]*?)\*\*/g, '$1');
}

/** Toggle **bold** around the selection of a textarea value. With no
 *  selection, inserts a marker pair and puts the caret inside so subsequent
 *  typing is bold. Returns the new value and selection range. */
export function toggleBold(value: string, start: number, end: number): { value: string; start: number; end: number } {
  const sel = value.slice(start, end);
  if (sel) {
    if (sel.startsWith('**') && sel.endsWith('**') && sel.length >= 4) {
      const inner = sel.slice(2, -2);
      return { value: value.slice(0, start) + inner + value.slice(end), start, end: start + inner.length };
    }
    if (value.slice(Math.max(0, start - 2), start) === '**' && value.slice(end, end + 2) === '**') {
      return { value: value.slice(0, start - 2) + sel + value.slice(end + 2), start: start - 2, end: start - 2 + sel.length };
    }
    return { value: value.slice(0, start) + '**' + sel + '**' + value.slice(end), start, end: end + 4 };
  }
  return { value: value.slice(0, start) + '****' + value.slice(start), start: start + 2, end: start + 2 };
}

/** Apply a bold toggle directly to a textarea element and return its new value. */
export function toggleBoldInTextarea(el: HTMLTextAreaElement): string {
  const r = toggleBold(el.value, el.selectionStart ?? 0, el.selectionEnd ?? 0);
  el.value = r.value;
  el.setSelectionRange(r.start, r.end);
  return r.value;
}

/** Site-wide lyric line spacing (server-stored, polled so every machine
 *  follows changes within seconds). Indic scripts get +0.3 for conjuncts. */
export function useLineSpacing(): number {
  const [spacing, setSpacing] = useState(1.6);
  useEffect(() => {
    let alive = true;
    const tick = () =>
      displayConfigApi
        .get()
        .then((c) => { if (alive && c.line_spacing) setSpacing(c.line_spacing); })
        .catch(() => {});
    tick();
    const id = setInterval(tick, 10000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return spacing;
}

export const INDIC_EXTRA = 0.3;
