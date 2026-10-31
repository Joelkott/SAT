'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { queueApi, songsApi, QueueItem, Song } from '@/lib/api';
import {
  remoteApi,
  songPingApi,
  newCommandId,
  errorCode,
  httpStatus,
  RemoteCapabilities,
  RemoteCommandType,
} from '@/lib/remote';
import { BellIcon, CheckIcon } from '@/components/icons';

interface ControllerPadProps {
  token: string;
  capabilities: RemoteCapabilities;
  disabled: boolean;
  liveTitle?: string;
  liveSongId?: string;
  queueVersion?: number;
  onUnpaired: () => void;
}

type Tab = 'songs' | 'bible';

interface Feedback {
  ok: boolean | null; // null = not confirmed
  text: string;
}

const FEEDBACK_MS = 3000;
const MAX_RESULTS = 20;
const STEP_SEND_KEY = 'sat-remote-step-send';
const TAB_KEY = 'sat-remote-tab';
const SCROLL_MAX_IN_FLIGHT = 3;

const btn =
  'min-h-14 rounded-xl border border-edge bg-surface-raised text-ink font-semibold cursor-pointer active:bg-surface-hover disabled:opacity-40 disabled:cursor-default';
const btnPrimary =
  'flex-1 min-h-20 rounded-2xl bg-accent-deep text-on-accent text-xl font-bold cursor-pointer active:bg-accent disabled:opacity-40 disabled:cursor-default';
const btnDanger =
  'min-h-12 px-4 rounded-xl border border-danger/60 bg-danger/15 text-danger font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-default';
const rowBtn =
  'min-h-12 px-3 text-sm font-medium cursor-pointer disabled:opacity-40 disabled:cursor-default';

// Controls only — no lyrics. Next/Prev and the display buttons are the
// primary actions; the song list lives in a sheet. Every tap submits one
// command (one id per tap, never auto-retried) and shows the acked result.
export default function ControllerPad({
  token,
  capabilities,
  disabled,
  liveTitle,
  liveSongId,
  queueVersion,
  onUnpaired,
}: ControllerPadProps) {
  const showBible = capabilities.display || capabilities.wall;
  const [tab, setTab] = useState<Tab>('songs');
  const [pending, setPending] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Song list sheet
  const [showSongs, setShowSongs] = useState(false);
  const [songTab, setSongTab] = useState<'queue' | 'search'>('queue');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueError, setQueueError] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [notified, setNotified] = useState<string | null>(null);

  // Bible
  const [reference, setReference] = useState('');
  const [stepSend, setStepSend] = useState(true);

  useEffect(() => {
    setStepSend(localStorage.getItem(STEP_SEND_KEY) !== '0');
    const t = localStorage.getItem(TAB_KEY);
    if (t === 'bible' || t === 'songs') setTab(t);
  }, []);

  useEffect(() => () => { if (feedbackTimer.current) clearTimeout(feedbackTimer.current); }, []);

  const handleTab = (t: Tab) => {
    setTab(t);
    try { localStorage.setItem(TAB_KEY, t); } catch {}
  };

  const toggleStepSend = () => {
    setStepSend((v) => {
      const next = !v;
      localStorage.setItem(STEP_SEND_KEY, next ? '1' : '0');
      return next;
    });
  };

  const showFeedback = useCallback((fb: Feedback) => {
    setFeedback(fb);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), FEEDBACK_MS);
  }, []);

  // ===== Command submit =====
  const send = async (type: RemoteCommandType, args: Record<string, unknown> = {}, key: string = type) => {
    setPending((p) => ({ ...p, [key]: (p[key] || 0) + 1 }));
    try {
      const r = await remoteApi.submit(token, { id: newCommandId(), type, args });
      switch (r.status) {
        case 'done':
          showFeedback({ ok: true, text: `✓ ${r.message || 'Done'}` });
          break;
        case 'offline':
          showFeedback({ ok: false, text: '✗ Control window offline' });
          break;
        case 'timeout':
          showFeedback({ ok: null, text: '? Not confirmed — check the screen' });
          break;
        default:
          showFeedback({ ok: false, text: `✗ ${r.message || 'Failed'}` });
      }
    } catch (err: any) {
      if (errorCode(err) === 'pair_invalid') {
        onUnpaired();
        return;
      }
      console.error('Error sending remote command:', { type, status: err?.response?.status });
      showFeedback({ ok: false, text: "✗ Couldn't reach the server" });
    } finally {
      setPending((p) => {
        const n = (p[key] || 1) - 1;
        const next = { ...p };
        if (n <= 0) delete next[key];
        else next[key] = n;
        return next;
      });
    }
  };

  const isBusy = (key: string, max = 1) => disabled || (pending[key] || 0) >= max;

  // Notify the other accounts about a song (not a remote command — it goes
  // to every other control window as a banner).
  const handleNotify = async (song: { id: string; title: string }) => {
    try {
      await songPingApi.send(song.id, song.title);
      setNotified(song.id);
      setTimeout(() => setNotified((n) => (n === song.id ? null : n)), 2000);
      showFeedback({ ok: true, text: `✓ Notified others: ${song.title}` });
    } catch (err) {
      showFeedback({ ok: false, text: httpStatus(err) === 429 ? '✗ Wait a moment before notifying again' : "✗ Couldn't notify" });
    }
  };

  // ===== Queue =====
  const loadQueue = useCallback(async () => {
    try {
      setQueue(await queueApi.getAll());
      setQueueError('');
    } catch (err) {
      console.error('Error loading queue:', err);
      setQueueError('Could not load the queue.');
    }
  }, []);

  useEffect(() => {
    if (capabilities.songs) loadQueue();
  }, [queueVersion, loadQueue, capabilities.songs]);

  // ===== Search (debounced) =====
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearchError('');
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await songsApi.search(q);
        if (!alive) return;
        setResults((res.songs || []).slice(0, MAX_RESULTS));
        setSearchError('');
      } catch (err) {
        console.error('Error searching songs:', err);
        if (alive) setSearchError('Search failed — check the connection.');
      } finally {
        if (alive) setIsSearching(false);
      }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [query]);

  const handleSendReference = (e: React.FormEvent) => {
    e.preventDefault();
    const ref = reference.trim();
    if (!ref) return;
    send('bible.send', { reference: ref, target: 'auto' });
  };

  const tabBtn = (active: boolean) =>
    `flex-1 h-11 rounded-lg text-sm font-semibold cursor-pointer ${
      active ? 'bg-accent-deep text-on-accent' : 'text-ink-dim hover:text-ink'
    }`;

  const activeTab: Tab = tab === 'bible' && showBible ? 'bible' : 'songs';
  const songsAvailable = capabilities.songs;

  const notifyButton = (song: { id: string; title: string }) => (
    <button
      type="button"
      className={`${rowBtn} text-ink-dim`}
      onClick={() => handleNotify(song)}
      aria-label={`Notify others about ${song.title}`}
      title="Notify the other teams"
    >
      {notified === song.id ? <CheckIcon className="w-4 h-4 text-ok" /> : <BellIcon className="w-4 h-4" />}
    </button>
  );

  const feedbackColor =
    feedback?.ok === true ? 'text-ok' : feedback?.ok === false ? 'text-danger' : 'text-ink-dim';

  return (
    <div style={{ paddingBottom: 'calc(7rem + env(safe-area-inset-bottom))' }}>
      {/* Songs | Bible */}
      {showBible && songsAvailable && (
        <div className="flex gap-1 p-1 mb-3 rounded-xl bg-surface-sunken border border-edge">
          <button type="button" className={tabBtn(activeTab === 'songs')} onClick={() => handleTab('songs')} aria-pressed={activeTab === 'songs'}>
            Songs
          </button>
          <button type="button" className={tabBtn(activeTab === 'bible')} onClick={() => handleTab('bible')} aria-pressed={activeTab === 'bible'}>
            Bible
          </button>
        </div>
      )}

      {activeTab === 'songs' ? (
        <div className="space-y-3">
          {songsAvailable && (
            <div className="flex items-center gap-2 min-w-0 px-1">
              <span className="text-sm text-ink-mute shrink-0">Live:</span>
              <span className="flex-1 min-w-0 truncate font-semibold">{liveTitle || 'Nothing live'}</span>
            </div>
          )}

          {/* Display controls — primary */}
          {capabilities.display && (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={btn} disabled={isBusy('scroll', SCROLL_MAX_IN_FLIGHT)}
                onClick={() => send('display.scroll', { dir: -1, amount: 'step' }, 'scroll')}>
                Scroll ▲
              </button>
              <button type="button" className={btn} disabled={isBusy('scroll', SCROLL_MAX_IN_FLIGHT)}
                onClick={() => send('display.scroll', { dir: 1, amount: 'step' }, 'scroll')}>
                Scroll ▼
              </button>
              <button type="button" className={btn} disabled={isBusy('scroll', SCROLL_MAX_IN_FLIGHT)}
                onClick={() => send('display.scroll', { dir: -1, amount: 'page' }, 'scroll')}>
                Page ▲
              </button>
              <button type="button" className={btn} disabled={isBusy('scroll', SCROLL_MAX_IN_FLIGHT)}
                onClick={() => send('display.scroll', { dir: 1, amount: 'page' }, 'scroll')}>
                Page ▼
              </button>
              <button type="button" className={btn} disabled={isBusy('zoom', SCROLL_MAX_IN_FLIGHT)}
                onClick={() => send('display.zoom', { delta: -0.1 }, 'zoom')}>
                Zoom −
              </button>
              <button type="button" className={btn} disabled={isBusy('zoom', SCROLL_MAX_IN_FLIGHT)}
                onClick={() => send('display.zoom', { delta: 0.1 }, 'zoom')}>
                Zoom +
              </button>
            </div>
          )}

          {songsAvailable && (
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 min-h-12 rounded-xl border border-edge bg-surface-raised text-ink font-semibold cursor-pointer active:bg-surface-hover"
                onClick={() => { setShowSongs(true); loadQueue(); }}
              >
                Song list
              </button>
              <button type="button" className={btnDanger} disabled={isBusy('song.clear')} onClick={() => send('song.clear')}>
                Clear to black
              </button>
            </div>
          )}

          {!songsAvailable && !capabilities.display && (
            <p className="px-3 py-6 text-center text-sm text-ink-mute">This control window offers no song controls.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-sm text-ink-mute px-1">
            Sends to the {capabilities.wall && !capabilities.display ? 'LED wall' : 'display'}
          </div>
          <form onSubmit={handleSendReference} className="flex gap-2">
            <input
              type="text"
              enterKeyHint="send"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. John 3:16"
              autoCapitalize="words"
              autoCorrect="off"
              aria-label="Bible reference"
              className="flex-1 min-w-0 h-14 px-3 bg-surface-input text-ink border border-edge rounded-xl focus:border-accent focus:outline-none text-base"
            />
            <button
              type="submit"
              className="min-h-14 px-5 rounded-xl bg-accent-deep text-on-accent font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-default"
              disabled={isBusy('bible.send') || !reference.trim()}
            >
              Send
            </button>
          </form>
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 min-h-12 cursor-pointer select-none">
              <input type="checkbox" checked={stepSend} onChange={toggleStepSend} className="w-5 h-5 accent-current" />
              <span className="text-sm">Send on step</span>
            </label>
            <button type="button" className={btnDanger} disabled={isBusy('bible.clear')} onClick={() => send('bible.clear')}>
              Clear scripture
            </button>
          </div>
        </div>
      )}

      {/* Primary Prev / Next — thumb zone, with the shared result line above */}
      <div className="fixed inset-x-0 bottom-0 z-30 bg-black/95 border-t border-edge px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <p className={`h-5 mb-1 text-sm truncate text-center ${feedbackColor}`} role="status">
          {feedback?.text ?? ''}
        </p>
        {activeTab === 'songs' ? (
          <div className="flex gap-2">
            <button type="button" className={btnPrimary} disabled={!songsAvailable || isBusy('song.prev')} onClick={() => send('song.prev')}>
              ‹ Prev
            </button>
            <button type="button" className={btnPrimary} disabled={!songsAvailable || isBusy('song.next')} onClick={() => send('song.next')}>
              Next ›
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button type="button" className={btnPrimary} disabled={isBusy('bible.step', SCROLL_MAX_IN_FLIGHT)}
              onClick={() => send('bible.step', { dir: -1, send: stepSend })}>
              ◀ Verse
            </button>
            <button type="button" className={btnPrimary} disabled={isBusy('bible.step', SCROLL_MAX_IN_FLIGHT)}
              onClick={() => send('bible.step', { dir: 1, send: stepSend })}>
              Verse ▶
            </button>
          </div>
        )}
      </div>

      {/* Song list sheet: queue / search with Live, + Queue, Notify */}
      {showSongs && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Song list">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowSongs(false)} />
          <div
            className="fixed inset-x-0 bottom-0 max-h-[85dvh] flex flex-col rounded-t-2xl bg-surface-raised border-t border-edge"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            <div className="flex items-center gap-2 px-3 py-2 border-b border-edge">
              <div className="flex-1 flex gap-1 p-0.5 rounded-lg bg-surface-sunken border border-edge">
                <button type="button" className={tabBtn(songTab === 'queue')} onClick={() => setSongTab('queue')}>
                  Queue
                </button>
                <button type="button" className={tabBtn(songTab === 'search')} onClick={() => setSongTab('search')}>
                  Search
                </button>
              </div>
              <button type="button" onClick={() => setShowSongs(false)} className="min-h-11 px-3 text-sm text-ink-dim hover:text-ink cursor-pointer">
                Done
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-3">
              {songTab === 'queue' ? (
                <>
                  {queueError && <p className="py-2 text-sm text-danger">{queueError}</p>}
                  {queue.length === 0 && !queueError ? (
                    <p className="py-6 text-center text-sm text-ink-mute">The queue is empty</p>
                  ) : (
                    <ul className="divide-y divide-edge">
                      {queue.map((item, i) => {
                        const isLive = !!liveSongId && item.song_id === liveSongId;
                        const liveKey = `song.live:q${item.id}`;
                        const removeKey = `queue.remove:${item.id}`;
                        const title = item.song?.title || item.song_id;
                        return (
                          <li key={item.id} className="flex items-center gap-1">
                            <span className="w-6 text-right text-sm text-ink-mute tabular-nums">{i + 1}</span>
                            <span className="flex-1 min-w-0 truncate pl-1">{title}</span>
                            {isLive && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-live text-white">LIVE</span>
                            )}
                            {notifyButton({ id: item.song_id, title })}
                            <button type="button" className={`${rowBtn} text-accent-hover`} disabled={isBusy(liveKey)}
                              onClick={() => send('song.live', { song_id: item.song_id }, liveKey)}>
                              Live
                            </button>
                            <button type="button" className={`${rowBtn} text-danger`} disabled={isBusy(removeKey)}
                              onClick={() => send('queue.remove', { queue_item_id: item.id }, removeKey)}>
                              Remove
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              ) : (
                <div className="py-2 space-y-2">
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search songs…"
                    aria-label="Search songs"
                    className="w-full h-11 px-3 bg-surface-input text-ink border border-edge rounded-lg focus:border-accent focus:outline-none text-base"
                  />
                  {searchError && <p className="text-sm text-danger">{searchError}</p>}
                  {isSearching && results.length === 0 && <p className="py-2 text-center text-sm text-ink-mute">Searching…</p>}
                  {!isSearching && query.trim().length >= 2 && results.length === 0 && !searchError && (
                    <p className="py-2 text-center text-sm text-ink-mute">No songs found</p>
                  )}
                  <ul className="divide-y divide-edge">
                    {results.map((song) => {
                      const liveKey = `song.live:s${song.id}`;
                      const addKey = `queue.add:${song.id}`;
                      return (
                        <li key={song.id} className="flex items-center gap-1">
                          <div className="flex-1 min-w-0 py-1">
                            <div className="truncate">{song.title}</div>
                            <div className="text-xs text-ink-mute capitalize">{song.language}</div>
                          </div>
                          {notifyButton({ id: song.id, title: song.title })}
                          <button type="button" className={`${rowBtn} text-accent-hover`} disabled={isBusy(liveKey)}
                            onClick={() => send('song.live', { song_id: song.id }, liveKey)}>
                            Live
                          </button>
                          <button type="button" className={`${rowBtn} text-accent-hover`} disabled={isBusy(addKey)}
                            onClick={() => send('queue.add', { song_id: song.id }, addKey)}>
                            + Queue
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
