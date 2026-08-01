'use client';

import { useEffect, useState } from 'react';
import { displayConfigApi } from '@/lib/api';

// Lyrics support one inline format: **bold**. Stored as plain text markers so
// the backend, search, and ProPresenter pipelines stay untouched.

const BOLD_RE = /(\*\*[^*][\s\S]*?\*\*)/g;

/** Render lyric text with **bold** segments as <strong>. */
export function FormattedLyrics({ text }: { text?: string | null }) {
  const parts = (text || '').split(BOLD_RE);
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
export function stripBold(text?: string | null): string {
  return (text || '').replace(/\*\*([^*][\s\S]*?)\*\*/g, '$1');
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

/** Site-wide lyric spacing (server-stored, polled so every machine follows
 *  changes within seconds). Indic scripts get +0.3 line-height for conjuncts. */
export function useLyricSpacing(): { line: number; paragraph: number } {
  const [spacing, setSpacing] = useState({ line: 1.6, paragraph: 1.0 });
  useEffect(() => {
    let alive = true;
    const tick = () =>
      displayConfigApi
        .get()
        .then((c) => {
          if (!alive) return;
          setSpacing({
            line: c.line_spacing || 1.6,
            paragraph: c.paragraph_spacing ?? 1.0,
          });
        })
        .catch(() => {});
    tick();
    const id = setInterval(tick, 10000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return spacing;
}

export const INDIC_EXTRA = 0.3;

/** Render lyrics as section blocks so the gap between sections (blank lines in
 *  the source) is controlled by paragraphSpacing instead of a literal blank
 *  line. paragraph = 1 reproduces the old single-blank-line look; 0 is flush. */
export function LyricBlocks({
  text,
  lineHeight,
  paragraphSpacing,
}: {
  text?: string | null;
  lineHeight: number;
  paragraphSpacing: number;
}) {
  const blocks = (text || '').split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, i) => (
        <div
          key={i}
          style={{
            lineHeight,
            marginTop: i === 0 ? 0 : `${paragraphSpacing}em`,
          }}
        >
          <FormattedLyrics text={block} />
        </div>
      ))}
    </>
  );
}
