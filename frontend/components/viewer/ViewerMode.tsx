'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { queueApi, songsApi, QueueItem, Song } from '@/lib/api';
import { liveSongApi, LiveSongState } from '@/lib/remote';
import { LyricBlocks, useLyricSpacing, INDIC_EXTRA } from '@/components/lyricsFormat';
import QueueSheet from '@/components/viewer/QueueSheet';
import SearchSheet from '@/components/viewer/SearchSheet';

interface ViewerModeProps {
  readOnly: boolean;
  wakeLockSupported?: boolean;
}

const INDIC_LANGUAGES = ['malayalam', 'hindi', 'tamil', 'telugu', 'kannada'];
const FONT_KEY = 'sat-viewer-font';
const FONT_DEFAULT = 22;
const FONT_MIN = 14;
const FONT_MAX = 40;
const FONT_STEP = 2;

const clampFont = (n: number) => Math.min(FONT_MAX, Math.max(FONT_MIN, n));

// Pocket stage monitor: follows whatever is live on the projector. Prev/Next
// browse the queue on this phone only — the viewer never changes live state.
export default function ViewerMode({ readOnly, wakeLockSupported = true }: ViewerModeProps) {
  const [live, setLive] = useState<LiveSongState | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [liveSongData, setLiveSongData] = useState<Song | null>(null);
  const [browse, setBrowse] = useState<Song | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [fontSize, setFontSize] = useState(FONT_DEFAULT);
  const [showQueue, setShowQueue] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [loadError, setLoadError] = useState('');
  const songCacheRef = useRef<Map<string, Song>>(new Map());
  const spacing = useLyricSpacing();

  // ===== Font size (persisted per device) =====
  useEffect(() => {
    const stored = Number(localStorage.getItem(FONT_KEY));
    if (stored) setFontSize(clampFont(stored));
  }, []);

  const changeFont = (delta: number) => {
    setFontSize((f) => {
      const next = clampFont(f + delta);
      localStorage.setItem(FONT_KEY, String(next));
      return next;
    });
  };

  // ===== Live state long-poll (promise-chained, no timers while healthy) =====
  useEffect(() => {
    let alive = true;
    let ac = new AbortController();
    let since = -1;
    const loop = async () => {
      while (alive) {
        try {
          const st = await liveSongApi.state(since, since === -1 ? 0 : 20, ac.signal);
          since = st.version;
          setLive(st);
          setReconnecting(false);
        } catch (err: any) {
          if (!alive) break;
          if (ac.signal.aborted) { ac = new AbortController(); continue; } // visibility refetch
          setReconnecting(true);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    };
    // iOS freezes JS in the background: the held request is dead on return. Abort → immediate refetch.
    const onVis = () => {
      if (document.visibilityState === 'visible') { since = -1; ac.abort(); }
    };
    document.addEventListener('visibilitychange', onVis);
    loop();
    return () => { alive = false; ac.abort(); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  // ===== Song loading (single song by id; never the full list) =====
  const loadSong = useCallback(async (id: string, fresh = false): Promise<Song> => {
    const cached = songCacheRef.current.get(id);
    if (cached && !fresh) return cached;
    const song = await songsApi.getById(id);
    songCacheRef.current.set(id, song);
    return song;
  }, []);

  const liveId = live && !live.cleared ? live.song?.id : undefined;
  const liveUpdatedAt = live?.updated_at;

  // Refetch on live id change or re-publish (updated_at), so edits show up.
  useEffect(() => {
    if (!liveId) {
      setLiveSongData(null);
      return;
    }
    let alive = true;
    loadSong(liveId, true)
      .then((song) => {
        if (!alive) return;
        setLiveSongData(song);
        setLoadError('');
      })
      .catch((err) => {
        console.error('Error loading live song:', err);
        if (alive) setLoadError('Could not load the live lyrics.');
      });
    return () => { alive = false; };
  }, [liveId, liveUpdatedAt, loadSong]);

  // ===== Queue =====
  const loadQueue = useCallback(async () => {
    try {
      setQueue(await queueApi.getAll());
    } catch (err) {
      console.error('Error loading queue:', err);
    }
  }, []);

  const queueVersion = live?.queue_version;
  useEffect(() => {
    loadQueue();
  }, [queueVersion, loadQueue]);

  // ===== Following vs browsing =====
  const shown = browse ?? liveSongData;
  const shownId = shown?.id;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [shownId]);

  // Browsing onto the song that just went live → resume following.
  useEffect(() => {
    if (browse && liveId && browse.id === liveId) setBrowse(null);
  }, [browse, liveId]);

  const browseTo = async (id: string, preloaded?: Song) => {
    if (id === liveId && liveSongData) {
      setBrowse(null);
      return;
    }
    try {
      // Queue/search payloads may be partial; only trust them if lyrics are present.
      const song = preloaded && typeof preloaded.display_lyrics === 'string' ? preloaded : await loadSong(id);
      if (preloaded && typeof preloaded.display_lyrics === 'string') songCacheRef.current.set(id, preloaded);
      setBrowse(song);
      setLoadError('');
    } catch (err) {
      console.error('Error loading song:', err);
      setLoadError('Could not load that song.');
    }
  };

  const handleStep = (dir: 1 | -1) => {
    if (queue.length === 0) return;
    const idx = shownId ? queue.findIndex((i) => i.song_id === shownId) : -1;
    const target = idx === -1 ? (dir === 1 ? 0 : -1) : idx + dir;
    if (target < 0 || target >= queue.length) return;
    const item = queue[target];
    browseTo(item.song_id, item.song);
  };

  const handleBackToLive = () => setBrowse(null);

  const livePos = liveId ? queue.findIndex((i) => i.song_id === liveId) : -1;
  const hasLive = !!liveId;
  const indic = INDIC_LANGUAGES.includes((shown?.language || '').toLowerCase());
  const lyrics = shown ? shown.music_ministry_lyrics || shown.display_lyrics : '';

  const barBtn =
    'flex-1 min-h-12 rounded-lg bg-surface-raised border border-edge text-ink font-medium cursor-pointer active:bg-surface-hover disabled:opacity-40';

  return (
    <div>
      {/* Live header */}
      <div
        className="sticky z-20 bg-black/95 border-b border-edge px-4 py-2"
        style={{ top: 'calc(env(safe-area-inset-top) + 3rem)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {hasLive && <span className="w-2.5 h-2.5 shrink-0 rounded-full bg-live animate-pulse" aria-label="Live" />}
          <span className="flex-1 min-w-0 truncate font-semibold">
            {shown ? shown.title : hasLive ? live?.song?.title : 'Nothing live'}
          </span>
          {livePos !== -1 && (
            <span className="shrink-0 px-2 py-0.5 rounded-full text-xs bg-surface-raised border border-edge text-ink-dim tabular-nums">
              {livePos + 1} / {queue.length} in queue
            </span>
          )}
        </div>
        <div className="text-xs text-ink-mute truncate mt-0.5">
          {browse
            ? `Browsing: ${browse.title}`
            : hasLive
              ? `Live from ${live?.source?.role ?? '—'}`
              : 'Waiting for a song…'}
        </div>
        {browse && (
          <button
            type="button"
            onClick={handleBackToLive}
            className="mt-2 w-full min-h-10 rounded-full bg-accent-deep text-on-accent text-sm font-medium cursor-pointer"
          >
            Not following · Back to live
            {hasLive && live?.song?.title ? ` (${live.song.title})` : ''}
          </button>
        )}
      </div>

      {reconnecting && (
        <div className="bg-warn/20 text-warn text-xs px-4 py-1 text-center">Reconnecting…</div>
      )}
      {loadError && <div className="bg-danger/10 text-danger text-xs px-4 py-1 text-center">{loadError}</div>}

      {/* Lyrics body (bottom padding clears the fixed control bar) */}
      <div
        className="px-4 py-5"
        style={{ paddingBottom: 'calc(9rem + env(safe-area-inset-bottom))' }}
      >
        {shown ? (
          <div
            className={`whitespace-pre-wrap break-words ${indic ? 'script-indic' : ''}`}
            style={{ fontSize }}
          >
            <LyricBlocks
              text={lyrics}
              lineHeight={spacing.line + (indic ? INDIC_EXTRA : 0)}
              paragraphSpacing={spacing.paragraph}
            />
          </div>
        ) : (
          <div className="py-24 text-center text-ink-mute">
            <p className="text-lg">Nothing live</p>
            <p className="text-sm mt-1">Waiting for a song…</p>
          </div>
        )}
        {!wakeLockSupported && (
          <p className="mt-8 text-center text-xs text-ink-mute">Keep-screen-on isn&apos;t available in this browser</p>
        )}
      </div>

      {/* Bottom control bar (one-handed, ≥48px targets) */}
      <div className="fixed inset-x-0 bottom-0 z-30 bg-black/95 border-t border-edge px-3 pt-2 pb-[env(safe-area-inset-bottom)]">
        <div className="flex gap-2">
          <button type="button" className={barBtn} onClick={() => handleStep(-1)} disabled={queue.length === 0}>
            ‹ Prev
          </button>
          <button
            type="button"
            className={barBtn}
            onClick={handleBackToLive}
          >
            Live
          </button>
          <button type="button" className={barBtn} onClick={() => handleStep(1)} disabled={queue.length === 0}>
            Next ›
          </button>
        </div>
        <div className="flex gap-2 mt-2 mb-2">
          <button type="button" className={barBtn} onClick={() => setShowQueue(true)}>
            Queue
          </button>
          <button type="button" className={barBtn} onClick={() => setShowSearch(true)}>
            Search
          </button>
          <button
            type="button"
            className={barBtn}
            onClick={() => changeFont(-FONT_STEP)}
            disabled={fontSize <= FONT_MIN}
            aria-label="Smaller text"
          >
            A−
          </button>
          <button
            type="button"
            className={barBtn}
            onClick={() => changeFont(FONT_STEP)}
            disabled={fontSize >= FONT_MAX}
            aria-label="Larger text"
          >
            A+
          </button>
        </div>
      </div>

      <QueueSheet
        open={showQueue}
        onClose={() => setShowQueue(false)}
        queue={queue}
        currentLiveId={liveId}
        readOnly={readOnly}
        onPick={(item) => browseTo(item.song_id, item.song)}
        onChanged={loadQueue}
      />
      <SearchSheet
        open={showSearch}
        onClose={() => setShowSearch(false)}
        readOnly={readOnly}
        onPick={(song) => browseTo(song.id)}
        onQueued={loadQueue}
      />
    </div>
  );
}
