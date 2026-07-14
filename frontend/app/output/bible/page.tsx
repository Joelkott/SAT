'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { liveApi, LiveScripture } from '@/lib/api';
import { parseVerses } from '@/components/bible/verseUtils';

// Chrome-less scripture output for LED wall capture (Resolume/OBS browser
// source). Renders two side panels flanking the IMAG region. The IMAG is a
// configurable rectangle (e.g. top-half centered), and the scripture panels
// align to its vertical band on either side.
//
// URL parameters (all optional):
//   w=2280   total canvas width in px
//   h=1120   total canvas height in px
//   cw=996   IMAG width in px  (default: 16:9 of canvas height, full-height)
//   ch=560   IMAG height in px (default: 9/16 of cw, capped at canvas height)
//   cy=0     IMAG top offset in px (0 = anchored to top)
//   center=  legacy alias for cw (full-height IMAG)
//   fs=1     font-size multiplier for the side panels
//   bg=transparent  transparent page background — use with an alpha-capable
//            capture (OBS browser source) so the glass boxes composite over
//            Resolume content; default is solid black
//   guides=1 draw layout guides (setup only — remove for live)
//
// Example for a 2280x1120 wall with a top-half centered 16:9 IMAG:
//   /output/bible?w=2280&h=1120&cw=996&ch=560
//
// Content updates by polling the backend once per second, so this page can
// run on a different machine than the operator's control window.

const POLL_MS = 1000;

function ScripturePanel({
  abbreviation,
  reference,
  content,
  indic,
  boxWpx,
  boxHpx,
  fontScale,
  blur,
  textScale,
}: {
  abbreviation: string;
  reference: string;
  content: string;
  indic: boolean;
  boxWpx: number;
  boxHpx: number;
  fontScale: number;
  blur: number;
  textScale: number;
}) {
  const verses = useMemo(() => parseVerses(content), [content]);
  const plainLength = Math.max(
    verses.reduce((n, v) => n + v.text.length, 0),
    1
  );

  // Text is fitted to the box's ACTUAL rendered px size, so it never outgrows
  // the box; text_scale nudges that up/down. The box itself fills its parent,
  // which is sized/positioned by the caller.
  const fill = 0.30; // fraction of box area given to glyphs
  const fitted = Math.sqrt((boxWpx * boxHpx * fill) / plainLength);
  const bodySize = Math.max(12, Math.min(boxWpx * 0.16, fitted)) * fontScale * textScale;
  const refSize = Math.max(14, Math.min(boxWpx * 0.11, bodySize * 0.72)) * fontScale;

  return (
    <div
      key={reference}
      className="fade-swap w-full h-full flex flex-col items-center justify-center text-center rounded-[0.9em] border border-white/20 shadow-2xl overflow-hidden"
      style={{
        fontSize: bodySize,
        padding: '0.9em 1em',
        backgroundColor: 'rgba(8, 9, 11, 0.55)',
        backdropFilter: `blur(${blur}px)`,
        WebkitBackdropFilter: `blur(${blur}px)`,
      }}
    >
        {/* ProPresenter-style reference: white box, black text */}
        <div
          className="inline-block bg-white text-black font-bold mb-[0.9em] rounded-[0.12em]"
          style={{ fontSize: refSize, padding: '0.18em 0.55em' }}
        >
          {reference}
          <span className="font-semibold opacity-60"> {abbreviation}</span>
        </div>
        {/* Scripture body: plain white text */}
        <div
          className={`text-white ${indic ? 'script-indic' : ''}`}
          style={{ lineHeight: indic ? 1.9 : 1.5 }}
        >
          {verses.map((v, i) => (
            <span key={v.num}>
              {verses.length > 1 && (
                <sup className="text-[0.55em] font-bold text-white/60 mr-[0.35em]">
                  {v.num}
                </sup>
              )}
              {v.text}
              {i < verses.length - 1 ? ' ' : ''}
            </span>
          ))}
        </div>
    </div>
  );
}

function BibleOutput() {
  const params = useSearchParams();
  const w = Number(params.get('w')) || 2280;
  const h = Number(params.get('h')) || 1120;
  // Default IMAG: 1280x720 top-centered — leaves ~500px scripture panels
  // on a 2280-wide wall. Override with cw/ch/cy for other rigs.
  const centerW =
    Number(params.get('cw')) ||
    Number(params.get('center')) ||
    1280;
  const centerH = Math.min(h, Number(params.get('ch')) || Math.round((centerW * 9) / 16));
  const centerY = Number(params.get('cy')) || 0;
  const fontScale = Number(params.get('fs')) || 1;
  const guides = params.get('guides') === '1';
  const transparent = params.get('bg') === 'transparent';
  const sideW = Math.max(0, Math.floor((w - centerW) / 2));

  const [state, setState] = useState<LiveScripture | null>(null);
  // Operator-controlled layout (blur + box width/height + text size). URL
  // params are fallbacks so existing capture URLs keep working before anyone
  // touches the controls.
  const [blur, setBlur] = useState<number>(Number(params.get('blur')) || 14);
  const [boxWpx, setBoxWpx] = useState<number>(Number(params.get('boxWpx')) || 0);
  const [boxHpx, setBoxHpx] = useState<number>(Number(params.get('boxHpx')) || 0);
  const [textScale, setTextScale] = useState<number>(Number(params.get('ts')) || 1);

  // No auth: this page is a browser-capture source (Resolume/OBS) and cannot
  // carry a session. It only reads the public GET /live/scripture endpoint.

  // Alpha capture: the app shell paints a dark background; clear it so an
  // OBS browser source can composite the glass boxes over Resolume layers.
  useEffect(() => {
    if (!transparent) return;
    const prevHtml = document.documentElement.style.background;
    const prevBody = document.body.style.background;
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    return () => {
      document.documentElement.style.background = prevHtml;
      document.body.style.background = prevBody;
    };
  }, [transparent]);

  useEffect(() => {
    let alive = true;
    let last = 0;
    const tick = async () => {
      try {
        const s = await liveApi.getScripture();
        if (alive && s.updated_at !== last) {
          last = s.updated_at;
          setState(s);
        }
      } catch {
        // Keep last-known scripture on transient errors — never blank mid-service.
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Poll the operator-set layout config so blur/box-size changes made in the
  // control window take effect on the wall within a second.
  useEffect(() => {
    let alive = true;
    let last = -1;
    const tick = async () => {
      try {
        const cfg = await liveApi.getOutputConfig();
        if (alive && cfg.updated_at !== last) {
          last = cfg.updated_at;
          setBlur(cfg.blur);
          setBoxWpx(cfg.box_w_px);
          setBoxHpx(cfg.box_h_px);
          setTextScale(cfg.text_scale);
        }
      } catch {
        // Keep last-known layout on transient errors.
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const columns = state?.visible ? state.columns || [] : [];
  const left = columns[0];
  const right = columns[1] || columns[0];

  // Each box is anchored to its top screen corner (left box top-left, right
  // box top-right) and extends inward by its width and down by its height.
  // 0 = fall back to filling the side panel / IMAG band. Boxes are NOT capped
  // to the panel — the operator sets exact px and the box grows past the panel
  // if asked.
  const boxW = boxWpx > 0 ? boxWpx : sideW;
  const boxH = boxHpx > 0 ? boxHpx : centerH;
  const boxTop = centerY;

  return (
    <div
      className="relative overflow-hidden"
      style={{ width: w, height: h, backgroundColor: transparent ? 'transparent' : 'black' }}
    >
      {/* Left box — anchored to the left edge, extends inward by boxW */}
      <div className="absolute left-0" style={{ top: boxTop, height: boxH, width: boxW }}>
        {left && (
          <ScripturePanel
            {...left}
            boxWpx={boxW}
            boxHpx={boxH}
            fontScale={fontScale}
            blur={blur}
            textScale={textScale}
          />
        )}
      </div>

      {/* IMAG region — occupied by the IMAG layer in Resolume */}
      {guides && (
        <div
          className="absolute border-2 border-dashed border-[#e9373a]/70 flex items-center justify-center"
          style={{ left: sideW, top: centerY, width: centerW, height: centerH }}
        >
          <span className="text-[#e9373a]/70 text-2xl font-bold tracking-widest">
            IMAG {centerW}×{centerH}
          </span>
        </div>
      )}

      {/* Right box — anchored to the right edge, extends inward by boxW */}
      <div className="absolute right-0" style={{ top: boxTop, height: boxH, width: boxW }}>
        {right && (
          <ScripturePanel
            {...right}
            boxWpx={boxW}
            boxHpx={boxH}
            fontScale={fontScale}
            blur={blur}
            textScale={textScale}
          />
        )}
      </div>
    </div>
  );
}

export default function BibleOutputPage() {
  return (
    <Suspense fallback={<div className="bg-black w-screen h-screen" />}>
      <BibleOutput />
    </Suspense>
  );
}
