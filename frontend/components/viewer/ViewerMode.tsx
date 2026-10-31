'use client';

import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { queueApi, songsApi, QueueItem, Song } from '@/lib/api';
import { LyricBlocks, useLyricSpacing, INDIC_EXTRA } from '@/components/lyricsFormat';
import QueueSheet from '@/components/viewer/QueueSheet';
import SearchSheet from '@/components/viewer/SearchSheet';

interface ViewerModeProps {
  readOnly: boolean;
  fontSize: number;
  settingsButton: ReactNode;
}

const INDIC_LANGUAGES = ['malayalam', 'hindi', 'tamil', 'telugu', 'kannada'];

// A songbook in your pocket: open any song from the queue or search and read
// its lyrics. Purely for viewing — nothing here follows or changes what's on
// the projector.
export default function ViewerMode({ readOnly, fontSize, settingsButton }: ViewerModeProps) {
  const [song, setSong] = useState<Song | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [loadError, setLoadError] = useState('');
  const songCacheRef = useRef<Map<string, Song>>(new Map());
  const spacing = useLyricSpacing();

  // ===== Queue (refreshed on open and whenever the phone comes back) =====
  const loadQueue = useCallback(async () => {
    try {
      setQueue(await queueApi.getAll());
      setLoadError('');
    } catch (err) {
      console.error('Error loading queue:', err);
      setLoadError('Could not load the song list.');
    } finally {
      setQueueLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadQueue();
    const onVis = () => { if (document.visibilityState === 'visible') loadQueue(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [loadQueue]);

  // ===== Song loading (single song by id; never the full list) =====
  const openSong = async (id: string, preloaded?: Song) => {
    try {
      let s = songCacheRef.current.get(id);
      if (!s) {
        // Queue/search payloads may be partial; only trust them if lyrics are present.
        s = preloaded && typeof preloaded.display_lyrics === 'string' ? preloaded : await songsApi.getById(id);
        songCacheRef.current.set(id, s);
      }
      setSong(s);
      setLoadError('');
      window.scrollTo(0, 0);
    } catch (err) {
      console.error('Error loading song:', err);
      setLoadError('Could not load that song.');
    }
  };

  const pos = song ? queue.findIndex((i) => i.song_id === song.id) : -1;

  const handleStep = (dir: 1 | -1) => {
    if (queue.length === 0) return;
    const target = pos === -1 ? (dir === 1 ? 0 : queue.length - 1) : pos + dir;
    if (target < 0 || target >= queue.length) return;
    openSong(queue[target].song_id, queue[target].song);
  };

  const indic = INDIC_LANGUAGES.includes((song?.language || '').toLowerCase());
  const lyrics = song ? song.music_ministry_lyrics || song.display_lyrics : '';

  const barBtn =
    'flex-1 min-h-12 rounded-lg bg-surface-raised border border-edge text-ink font-medium cursor-pointer active:bg-surface-hover disabled:opacity-40';

  return (
    <div>
      {/* One slim header row: title (or "Songs"), queue position, settings */}
      <div
        className="sticky z-20 h-11 bg-black/95 border-b border-edge px-4 flex items-center gap-2 min-w-0"
        style={{ top: 'env(safe-area-inset-top)' }}
      >
        {song && (
          <button
            type="button"
            onClick={() => setSong(null)}
            aria-label="Back to the song list"
            className="shrink-0 -ml-2 w-9 h-9 flex items-center justify-center rounded-lg text-ink-dim hover:text-ink cursor-pointer text-xl"
          >
            ‹
          </button>
        )}
        <span className="flex-1 min-w-0 truncate font-semibold text-sm">{song ? song.title : 'Songs'}</span>
        {pos !== -1 && (
          <span className="shrink-0 text-xs text-ink-mute tabular-nums">
            {pos + 1}/{queue.length}
          </span>
        )}
        {settingsButton}
      </div>

      {loadError && <div className="bg-danger/10 text-danger text-xs px-4 py-1 text-center" role="status">{loadError}</div>}

      <div style={{ paddingBottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}>
        {song ? (
          <div
            className={`px-4 pt-4 whitespace-pre-wrap break-words ${indic ? 'script-indic' : ''}`}
            style={{ fontSize }}
          >
            <LyricBlocks
              text={lyrics}
              lineHeight={spacing.line + (indic ? INDIC_EXTRA : 0)}
              paragraphSpacing={spacing.paragraph}
            />
          </div>
        ) : queue.length > 0 ? (
          // Home: the service queue as a song list.
          <ul className="divide-y divide-edge">
            {queue.map((item, i) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => openSong(item.song_id, item.song)}
                  className="w-full min-h-14 flex items-center gap-3 px-4 py-2 text-left cursor-pointer active:bg-surface-hover"
                >
                  <span className="w-6 text-right text-sm text-ink-mute tabular-nums">{i + 1}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{item.song?.title || item.song_id}</span>
                    {item.song?.language && (
                      <span className="block text-xs text-ink-mute capitalize">{item.song.language}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="py-24 px-6 text-center text-ink-mute">
            <p className="text-lg">{queueLoaded ? 'The queue is empty' : 'Loading…'}</p>
            {queueLoaded && <p className="text-sm mt-1">Use Search to find any song.</p>}
          </div>
        )}
      </div>

      {/* Bottom bar: one row, one-handed, ≥48px targets */}
      <div className="fixed inset-x-0 bottom-0 z-30 bg-black/95 border-t border-edge px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="flex gap-2">
          <button type="button" className={barBtn} onClick={() => handleStep(-1)} disabled={queue.length === 0} aria-label="Previous song">
            ‹
          </button>
          <button type="button" className={barBtn} onClick={() => { setShowQueue(true); loadQueue(); }}>
            Songs
          </button>
          <button type="button" className={barBtn} onClick={() => setShowSearch(true)}>
            Search
          </button>
          <button type="button" className={barBtn} onClick={() => handleStep(1)} disabled={queue.length === 0} aria-label="Next song">
            ›
          </button>
        </div>
      </div>

      <QueueSheet
        open={showQueue}
        onClose={() => setShowQueue(false)}
        queue={queue}
        readOnly={readOnly}
        onPick={(item) => openSong(item.song_id, item.song)}
        onChanged={loadQueue}
      />
      <SearchSheet
        open={showSearch}
        onClose={() => setShowSearch(false)}
        readOnly={readOnly}
        onPick={(s) => openSong(s.id)}
        onQueued={loadQueue}
      />
    </div>
  );
}
