'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface SplitLyricsViewProps {
  lyrics: string;
  zoomLevel: number;
  textAlign?: 'left' | 'center' | 'right';
}

interface Pane {
  id: string;
  heightPercent: number;
}

const MIN_PANE_HEIGHT = 5; // Minimum 5% height per pane

export default function SplitLyricsView({ lyrics, zoomLevel, textAlign = 'center' }: SplitLyricsViewProps) {
  const [panes, setPanes] = useState<Pane[]>([
    { id: '1', heightPercent: 100 },
  ]);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Add a new split
  const addSplit = () => {
    const newPaneCount = panes.length + 1;
    const equalHeight = 100 / newPaneCount;
    const newPanes = panes.map(p => ({ ...p, heightPercent: equalHeight }));
    newPanes.push({ id: Date.now().toString(), heightPercent: equalHeight });
    setPanes(newPanes);
  };

  // Remove a split (can go down to 1 pane)
  const removeSplit = (index: number) => {
    if (panes.length <= 1) return;
    const removedHeight = panes[index].heightPercent;
    const remainingPanes = panes.filter((_, i) => i !== index);
    const distributeHeight = removedHeight / remainingPanes.length;
    setPanes(remainingPanes.map(p => ({ 
      ...p, 
      heightPercent: p.heightPercent + distributeHeight 
    })));
  };

  // Handle mouse dragging for splitter
  const handleMouseDown = useCallback((index: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    setDraggingIndex(index);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (draggingIndex === null || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const mousePercent = ((e.clientY - rect.top) / rect.height) * 100;

    // Calculate cumulative heights up to the dragging splitter
    let cumulativeHeight = 0;
    for (let i = 0; i < draggingIndex; i++) {
      cumulativeHeight += panes[i].heightPercent;
    }

    // New height for the pane above the splitter
    const maxHeight = 100 - (panes.length - 1) * MIN_PANE_HEIGHT;
    const newTopHeight = Math.max(MIN_PANE_HEIGHT, Math.min(mousePercent - cumulativeHeight, maxHeight));
    const diff = newTopHeight - panes[draggingIndex].heightPercent;

    // Adjust the pane below
    const newBottomHeight = panes[draggingIndex + 1].heightPercent - diff;
    if (newBottomHeight < MIN_PANE_HEIGHT) return;

    setPanes(prev => prev.map((pane, i) => {
      if (i === draggingIndex) return { ...pane, heightPercent: newTopHeight };
      if (i === draggingIndex + 1) return { ...pane, heightPercent: newBottomHeight };
      return pane;
    }));
  }, [draggingIndex, panes]);

  const handleMouseUp = useCallback(() => {
    setDraggingIndex(null);
  }, []);

  useEffect(() => {
    if (draggingIndex !== null) {
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [draggingIndex, handleMouseMove, handleMouseUp]);

  // Touch support
  const handleTouchStart = useCallback((index: number) => (e: React.TouchEvent) => {
    e.preventDefault();
    setDraggingIndex(index);
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (draggingIndex === null || !containerRef.current) return;

    const touch = e.touches[0];
    const rect = containerRef.current.getBoundingClientRect();
    const touchPercent = ((touch.clientY - rect.top) / rect.height) * 100;

    let cumulativeHeight = 0;
    for (let i = 0; i < draggingIndex; i++) {
      cumulativeHeight += panes[i].heightPercent;
    }

    const maxHeight = 100 - (panes.length - 1) * MIN_PANE_HEIGHT;
    const newTopHeight = Math.max(MIN_PANE_HEIGHT, Math.min(touchPercent - cumulativeHeight, maxHeight));
    const diff = newTopHeight - panes[draggingIndex].heightPercent;
    const newBottomHeight = panes[draggingIndex + 1].heightPercent - diff;
    if (newBottomHeight < MIN_PANE_HEIGHT) return;

    setPanes(prev => prev.map((pane, i) => {
      if (i === draggingIndex) return { ...pane, heightPercent: newTopHeight };
      if (i === draggingIndex + 1) return { ...pane, heightPercent: newBottomHeight };
      return pane;
    }));
  }, [draggingIndex, panes]);

  useEffect(() => {
    if (draggingIndex !== null) {
      window.addEventListener('touchmove', handleTouchMove);
      window.addEventListener('touchend', handleMouseUp);
      return () => {
        window.removeEventListener('touchmove', handleTouchMove);
        window.removeEventListener('touchend', handleMouseUp);
      };
    }
  }, [draggingIndex, handleTouchMove, handleMouseUp]);

  const renderLyrics = () => {
    const alignClass = textAlign === 'left' ? 'text-left' : textAlign === 'right' ? 'text-right' : 'text-center';
    
    // Calculate font size based on zoom level
    // Base sizes: 1.125rem (lg), 1.25rem (xl), 1.5rem (2xl), 1.875rem (3xl), 2.25rem (4xl), 3rem (5xl)
    // Using rem so text reflows properly instead of scaling
    const baseFontSize = 1.5; // Base: 1.5rem (24px) for medium screens
    const fontSize = `${baseFontSize * zoomLevel}rem`;
    
    return (
      <div className="w-full max-w-4xl md:max-w-5xl lg:max-w-6xl xl:max-w-7xl mx-auto">
        <pre 
          className={`whitespace-pre-wrap ${alignClass} w-full leading-relaxed text-white`}
          style={{ fontSize }}
        >
          {lyrics}
        </pre>
      </div>
    );
  };

  return (
    <div ref={containerRef} className="h-full w-full flex flex-col relative">
      {/* Add/Remove Split Controls */}
      <div className="absolute top-4 left-4 z-50 flex items-center gap-2">
        <button
          onClick={addSplit}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium 
                     bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm
                     border border-white/20 transition-all duration-200"
          title="Add split"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add
        </button>
        
        {panes.length > 1 && (
          <button
            onClick={() => removeSplit(panes.length - 1)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium 
                       bg-white/10 hover:bg-red-500/30 text-white hover:text-red-300 backdrop-blur-sm
                       border border-white/20 hover:border-red-500/50 transition-all duration-200"
            title="Remove last split"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
            Remove
          </button>
        )}

        <span className="text-xs text-white/50 ml-1">
          {panes.length} {panes.length === 1 ? 'pane' : 'panes'}
        </span>
      </div>

      {panes.map((pane, index) => (
        <div key={pane.id} className="contents">
          {/* Pane */}
          <div
            className="overflow-y-auto overflow-x-hidden relative group/pane"
            style={{ height: `${pane.heightPercent}%` }}
          >
            <div className="p-4 sm:p-6 md:p-8 lg:p-12">
              {renderLyrics()}
            </div>
            
            {/* Individual pane remove button (shows on hover, only if more than 1 pane) */}
            {panes.length > 1 && (
              <button
                onClick={() => removeSplit(index)}
                className="absolute top-2 right-2 w-6 h-6 rounded-full 
                           bg-red-500/0 hover:bg-red-500/30 text-red-400/0 hover:text-red-400
                           flex items-center justify-center transition-all duration-200
                           opacity-0 group-hover/pane:opacity-100"
                title="Remove this pane"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Splitter (between panes, not after last) */}
          {index < panes.length - 1 && (
            <div
              className="relative flex-shrink-0 cursor-row-resize group h-[3px] mx-4"
              onMouseDown={handleMouseDown(index)}
              onTouchStart={handleTouchStart(index)}
            >
              {/* Sleek gradient line */}
              <div 
                className={`
                  absolute inset-0 rounded-full overflow-hidden
                  ${draggingIndex === index 
                    ? 'bg-gradient-to-r from-transparent via-amber-400 to-transparent' 
                    : 'bg-gradient-to-r from-transparent via-white/20 to-transparent group-hover:via-amber-400/60'
                  }
                  transition-all duration-200
                `}
              />
              
              {/* Center handle indicator */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 
                              flex items-center justify-center pointer-events-none">
                <div 
                  className={`
                    w-12 h-5 rounded-full flex items-center justify-center gap-0.5
                    ${draggingIndex === index 
                      ? 'bg-amber-400/30' 
                      : 'bg-white/5 group-hover:bg-amber-400/20'
                    }
                    transition-all duration-200 backdrop-blur-sm
                  `}
                >
                  <div className={`w-4 h-0.5 rounded-full ${draggingIndex === index ? 'bg-amber-400' : 'bg-white/40 group-hover:bg-amber-400/80'} transition-colors`} />
                  <div className={`w-4 h-0.5 rounded-full ${draggingIndex === index ? 'bg-amber-400' : 'bg-white/40 group-hover:bg-amber-400/80'} transition-colors`} />
                </div>
              </div>

              {/* Invisible larger hit area */}
              <div className="absolute -inset-y-2 inset-x-0" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
