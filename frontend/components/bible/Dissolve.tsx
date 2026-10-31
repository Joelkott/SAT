'use client';

import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';

// useLayoutEffect warns during SSR; fall back to useEffect on the server.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

type Layer = { id: number; node: ReactNode };

/** Crossfades its content whenever `itemKey` changes: the outgoing content
 *  fades out while the incoming fades in, stacked in the same cell. Each
 *  layer is its own mount, so content that measures itself (useFitText)
 *  keeps its own size while it dissolves. */
export default function Dissolve({
  itemKey,
  children,
  durationMs = 500,
  className = '',
}: {
  itemKey: string;
  children: ReactNode;
  durationMs?: number;
  className?: string;
}) {
  // A fresh layer id per key change remounts the incoming content (so it
  // fades in) even when stepping back to a key that is still fading out.
  const genRef = useRef(0);
  const keyRef = useRef(itemKey);
  if (keyRef.current !== itemKey) {
    keyRef.current = itemKey;
    genRef.current++;
  }
  const currentId = genRef.current;

  const [leaving, setLeaving] = useState<Layer[]>([]);
  const lastRef = useRef<Layer>({ id: currentId, node: children });
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Runs before paint, so the outgoing layer never drops out for a frame.
  useIsomorphicLayoutEffect(() => {
    const last = lastRef.current;
    if (last.id !== currentId) {
      // Fast stepping: keep only the most recent outgoing layer.
      setLeaving((l) => [...l.slice(-1), last]);
      timersRef.current.push(
        setTimeout(() => setLeaving((l) => l.filter((x) => x.id !== last.id)), durationMs)
      );
    }
    lastRef.current = { id: currentId, node: children };
  });

  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  const style = { '--dissolve-ms': `${durationMs}ms` } as React.CSSProperties;
  return (
    <div className={`grid grid-cols-1 grid-rows-1 ${className}`} style={style}>
      {leaving.map((l) => (
        <div key={l.id} className="dissolve-out col-start-1 row-start-1 min-w-0 min-h-0" aria-hidden>
          {l.node}
        </div>
      ))}
      <div key={currentId} className="dissolve-in col-start-1 row-start-1 min-w-0 min-h-0">
        {children}
      </div>
    </div>
  );
}
