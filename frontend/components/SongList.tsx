'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { Song } from '@/lib/api';
import { PencilIcon, PlayIcon, ListPlusIcon } from '@/components/icons';

interface SongListProps {
  songs: Song[];
  onSelectSong: (song: Song) => void;
  selectedSongId?: string;
  loading?: boolean;
  onEdit?: (song: Song) => void;
  onSendToLive?: (song: Song) => void;
  onAddToQueue?: (song: Song) => void;
  onHover?: (song: Song | null) => void;
}

// Rows rendered initially / added per scroll step. Rendering the full 2,700
// song library at once creates ~40k DOM nodes and makes every interaction lag.
const PAGE = 150;

function SongList({ songs, onSelectSong, selectedSongId, loading, onEdit, onSendToLive, onAddToQueue, onHover }: SongListProps) {
  const [addedId, setAddedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // New song set (search results, reload): start from the first page again.
  useEffect(() => {
    setVisibleCount(PAGE);
  }, [songs]);

  // Grow the list as the user scrolls near the bottom.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || visibleCount >= songs.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((n) => Math.min(n + PAGE, songs.length));
        }
      },
      { rootMargin: '400px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visibleCount, songs.length]);

  if (loading) {
    return (
      <div className="bg-surface-raised rounded-xl border border-edge p-6 text-center">
        <p className="text-ink-mute text-sm">Loading songs...</p>
      </div>
    );
  }

  if (songs.length === 0) {
    return (
      <div className="bg-surface-raised rounded-xl border border-edge p-8 text-center space-y-1">
        <p className="text-ink-dim font-medium">No songs found</p>
        <p className="text-ink-mute text-sm">Try a different search, or add a new song with the + button.</p>
      </div>
    );
  }

  return (
    <div className="bg-surface-raised rounded-xl border border-edge overflow-hidden">
      <div className="divide-y divide-edge max-h-[540px] overflow-y-auto">
        {songs.slice(0, visibleCount).map((song) => {
          const selected = selectedSongId === song.id;
          return (
            <div
              key={song.id}
              onMouseEnter={() => onHover?.(song)}
              className={`w-full text-left p-4 flex items-start gap-3 transition-colors duration-150 border-l-2 ${
                selected
                  ? 'bg-surface-hover border-l-accent'
                  : 'border-l-transparent hover:bg-surface-hover/60'
              }`}
            >
              <div
                className="flex-1 min-w-0 cursor-pointer"
                onClick={() => onSelectSong(song)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onSelectSong(song);
                  }
                }}
              >
                <h3 className="font-semibold text-ink mb-0.5 truncate">
                  {song.title}
                </h3>
                {song.artist && (
                  <p className="text-sm text-ink-mute mb-1.5 truncate">
                    {song.artist}
                  </p>
                )}
                <div className="flex items-center gap-2 text-xs">
                  <span className="bg-surface-sunken border border-edge text-ink-dim px-2 py-0.5 rounded-full capitalize shrink-0">
                    {song.language || 'Unknown'}
                  </span>
                  <span className="text-ink-mute truncate">
                    {(song.music_ministry_lyrics || song.display_lyrics).substring(0, 80)}
                  </span>
                </div>
              </div>

              <div className="flex gap-1.5 shrink-0">
                {onAddToQueue && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddToQueue(song);
                      setAddedId(song.id);
                      setTimeout(() => setAddedId((cur) => (cur === song.id ? null : cur)), 1200);
                    }}
                    className={`h-9 w-9 flex items-center justify-center rounded-md border cursor-pointer transition-colors duration-150 ${
                      addedId === song.id
                        ? 'border-ok/60 text-ok'
                        : 'border-edge text-ink-dim hover:text-ink hover:border-edge-strong hover:bg-surface-hover'
                    }`}
                    aria-label={`Add ${song.title} to queue`}
                    title={addedId === song.id ? 'Added' : 'Add to queue'}
                  >
                    <ListPlusIcon className="w-4 h-4" />
                  </button>
                )}
                {onEdit && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(song);
                    }}
                    className="h-9 w-9 flex items-center justify-center rounded-md border border-edge text-ink-dim hover:text-ink hover:border-edge-strong hover:bg-surface-hover cursor-pointer transition-colors duration-150"
                    aria-label={`Edit ${song.title}`}
                    title="Edit"
                  >
                    <PencilIcon className="w-4 h-4" />
                  </button>
                )}
                {onSendToLive && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSendToLive(song);
                    }}
                    className="h-9 w-9 flex items-center justify-center rounded-md border border-ok/40 text-ok hover:bg-ok/15 hover:border-ok/70 cursor-pointer transition-colors duration-150"
                    aria-label={`Send ${song.title} to live`}
                    title="Send to Live"
                  >
                    <PlayIcon className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {visibleCount < songs.length && (
          <div ref={sentinelRef} className="p-3 text-center text-xs text-ink-mute">
            Showing {visibleCount} of {songs.length} — scroll for more
          </div>
        )}
      </div>
    </div>
  );
}

// Memoized so hover/preview/zoom state changes in the parent don't re-render
// the (potentially very long) list.
export default memo(SongList);
