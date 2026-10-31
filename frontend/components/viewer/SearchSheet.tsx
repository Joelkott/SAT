'use client';

import { useEffect, useRef, useState } from 'react';
import { queueApi, songsApi, Song } from '@/lib/api';

interface SearchSheetProps {
  open: boolean;
  onClose: () => void;
  readOnly: boolean;
  onPick: (song: Song) => void;
  onQueued: () => void;
}

const MAX_RESULTS = 30;

// Bottom-sheet song search. Uses the search endpoint only (never the full song
// list — too large for a phone). Tap a result to browse it locally; non-guest
// roles also get "+ Queue".
export default function SearchSheet({ open, onClose, readOnly, onPick, onQueued }: SearchSheetProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setError('');
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await songsApi.search(q);
        if (!alive) return;
        setResults((res.songs || []).slice(0, MAX_RESULTS));
        setError('');
      } catch (err) {
        console.error('Error searching songs:', err);
        if (alive) setError('Search failed — check the connection.');
      } finally {
        if (alive) setIsSearching(false);
      }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [query, open]);

  if (!open) return null;

  const handleQueue = async (song: Song) => {
    if (readOnly) return;
    try {
      await queueApi.add(song.id);
      setNotice((n) => ({ ...n, [song.id]: 'Queued' }));
      onQueued();
    } catch (err: any) {
      const msg = err?.response?.status === 409 ? 'Already queued' : 'Failed';
      setNotice((n) => ({ ...n, [song.id]: msg }));
    }
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="fixed inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl bg-surface-raised border-t border-edge"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="sticky top-0 flex items-center gap-2 px-3 py-2 bg-surface-raised border-b border-edge">
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search songs…"
            className="flex-1 min-w-0 h-11 px-3 bg-surface-input text-ink border border-edge rounded-lg focus:border-accent focus:outline-none text-base"
          />
          <button type="button" onClick={onClose} className="min-h-12 px-3 text-sm text-ink-dim hover:text-ink cursor-pointer">
            Close
          </button>
        </div>
        {error && <p className="px-4 py-2 text-sm text-danger">{error}</p>}
        {isSearching && results.length === 0 && <p className="px-4 py-6 text-center text-ink-mute">Searching…</p>}
        {!isSearching && query.trim().length >= 2 && results.length === 0 && !error && (
          <p className="px-4 py-6 text-center text-ink-mute">No songs found</p>
        )}
        <ul>
          {results.map((song) => (
            <li key={song.id} className="flex items-center gap-2 border-b border-edge last:border-b-0">
              <button
                type="button"
                onClick={() => { onPick(song); onClose(); }}
                className="flex-1 min-w-0 min-h-12 px-4 py-2 text-left cursor-pointer hover:bg-surface-hover"
              >
                <div className="truncate">{song.title}</div>
                <div className="text-xs text-ink-mute capitalize">{song.language}</div>
              </button>
              {!readOnly && (
                notice[song.id] ? (
                  <span className="px-4 text-xs text-ink-mute">{notice[song.id]}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleQueue(song)}
                    className="min-h-12 px-4 text-sm text-accent-hover cursor-pointer"
                  >
                    + Queue
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
