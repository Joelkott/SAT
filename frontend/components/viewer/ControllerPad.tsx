'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { queueApi, songsApi, QueueItem, Song } from '@/lib/api';
import {
  remoteApi,
  newCommandId,
  errorCode,
  RemoteCapabilities,
  RemoteCommandType,
} from '@/lib/remote';

interface ControllerPadProps {
  token: string;
  capabilities: RemoteCapabilities;
  disabled: boolean;
  liveTitle?: string;
  liveSongId?: string;
  queueVersion?: number;
  onUnpaired: () => void;
}

type Section = 'songs' | 'bible' | 'display';

interface Feedback {
  ok: boolean | null; // null = not confirmed
  text: string;
}

const FEEDBACK_MS = 3000;
const MAX_RESULTS = 20;
const STEP_SEND_KEY = 'sat-remote-step-send';
const SCROLL_MAX_IN_FLIGHT = 3;

const SECTION_OF: Record<RemoteCommandType, Section> = {
  'song.live': 'songs',
  'song.next': 'songs',
  'song.prev': 'songs',
  'song.clear': 'songs',
  'queue.add': 'songs',
  'queue.remove': 'songs',
  'bible.send': 'bible',
  'bible.step': 'bible',
  'bible.clear': 'bible',
  'display.scroll': 'display',
  'display.zoom': 'display',
};

const card = 'bg-surface-raised border border-edge rounded-xl p-3 space-y-3';
const btn =
  'min-h-12 px-3 rounded-lg border border-edge bg-surface-input text-ink font-medium cursor-pointer hover:bg-surface-hover disabled:opacity-40 disabled:cursor-default';
const btnDanger =
  'min-h-12 px-3 rounded-lg border border-danger/60 bg-danger/15 text-danger font-medium cursor-pointer disabled:opacity-40 disabled:cursor-default';
const btnSmall =
  'min-h-12 px-3 text-sm cursor-pointer disabled:opacity-40 disabled:cursor-default';

// Song / Bible / Display controls. Every tap submits one command (one id per
// tap, never auto-retried) and shows the control window's acked result.
export default function ControllerPad({
  token,
  capabilities,
  disabled,
  liveTitle,
  liveSongId,
  queueVersion,
  onUnpaired,
}: ControllerPadProps) {
  const [pending, setPending] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState<Partial<Record<Section, Feedback>>>({});
  const feedbackTimers = useRef<Partial<Record<Section, ReturnType<typeof setTimeout>>>>({});

  // Songs
  const [songTab, setSongTab] = useState<'queue' | 'search'>('queue');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueError, setQueueError] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  // Bible
  const [reference, setReference] = useState('');
  const [stepSend, setStepSend] = useState(true);

  useEffect(() => {
    setStepSend(localStorage.getItem(STEP_SEND_KEY) !== '0');
  }, []);

  useEffect(() => () => {
    Object.values(feedbackTimers.current).forEach((t) => t && clearTimeout(t));
  }, []);

  const toggleStepSend = () => {
    setStepSend((v) => {
      const next = !v;
      localStorage.setItem(STEP_SEND_KEY, next ? '1' : '0');
      return next;
    });
  };

  const showFeedback = useCallback((section: Section, fb: Feedback) => {
    setFeedback((f) => ({ ...f, [section]: fb }));
    const prev = feedbackTimers.current[section];
    if (prev) clearTimeout(prev);
    feedbackTimers.current[section] = setTimeout(() => {
      setFeedback((f) => ({ ...f, [section]: undefined }));
    }, FEEDBACK_MS);
  }, []);

  // ===== Command submit =====
  const send = async (type: RemoteCommandType, args: Record<string, unknown> = {}, key: string = type) => {
    const section = SECTION_OF[type];
    setPending((p) => ({ ...p, [key]: (p[key] || 0) + 1 }));
    try {
      const r = await remoteApi.submit(token, { id: newCommandId(), type, args });
      switch (r.status) {
        case 'done':
          showFeedback(section, { ok: true, text: `✓ ${r.message || 'Done'}` });
          break;
        case 'offline':
          showFeedback(section, { ok: false, text: '✗ Control window offline' });
          break;
        case 'timeout':
          showFeedback(section, { ok: null, text: '? Not confirmed — check the viewer' });
          break;
        default:
          showFeedback(section, { ok: false, text: `✗ ${r.message || 'Failed'}` });
      }
    } catch (err: any) {
      if (errorCode(err) === 'pair_invalid') {
        onUnpaired();
        return;
      }
      console.error('Error sending remote command:', { type, status: err?.response?.status });
      showFeedback(section, { ok: false, text: "✗ Couldn't reach the server" });
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

  const renderFeedback = (section: Section) => {
    const fb = feedback[section];
    if (!fb) return null;
    const color = fb.ok === true ? 'text-ok' : fb.ok === false ? 'text-danger' : 'text-ink-dim';
    return (
      <p className={`text-sm ${color}`} role="status">
        {fb.text}
      </p>
    );
  };

  const showBible = capabilities.display || capabilities.wall;
  const bibleTarget = capabilities.wall && !capabilities.display ? 'LED wall' : 'Display';

  const tabBtn = (active: boolean) =>
    `flex-1 h-10 rounded-md text-sm font-medium cursor-pointer ${
      active ? 'bg-accent-deep text-on-accent' : 'text-ink-dim hover:text-ink'
    }`;

  return (
    <div className="space-y-3">
      {/* ===== Songs ===== */}
      {capabilities.songs && (
        <section className={card}>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-semibold">Songs</h3>
            <span className="text-sm text-ink-dim truncate min-w-0">
              Live: <span className="text-ink">{liveTitle || 'Nothing live'}</span>
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" className={btn} disabled={isBusy('song.prev')} onClick={() => send('song.prev')}>
              ‹ Prev
            </button>
            <button type="button" className={btn} disabled={isBusy('song.next')} onClick={() => send('song.next')}>
              Next ›
            </button>
            <button type="button" className={btnDanger} disabled={isBusy('song.clear')} onClick={() => send('song.clear')}>
              Clear to black
            </button>
          </div>
          {renderFeedback('songs')}

          <div className="flex gap-1 p-0.5 rounded-lg bg-surface-sunken border border-edge">
            <button type="button" className={tabBtn(songTab === 'queue')} onClick={() => setSongTab('queue')}>
              Queue
            </button>
            <button type="button" className={tabBtn(songTab === 'search')} onClick={() => setSongTab('search')}>
              Search
            </button>
          </div>

          {songTab === 'queue' ? (
            <div>
              {queueError && <p className="py-2 text-sm text-danger">{queueError}</p>}
              {queue.length === 0 && !queueError ? (
                <p className="py-4 text-center text-sm text-ink-mute">The queue is empty</p>
              ) : (
                <ul className="divide-y divide-edge">
                  {queue.map((item, i) => {
                    const isLive = !!liveSongId && item.song_id === liveSongId;
                    const liveKey = `song.live:q${item.id}`;
                    const removeKey = `queue.remove:${item.id}`;
                    return (
                      <li key={item.id} className="flex items-center gap-2">
                        <span className="w-6 text-right text-sm text-ink-mute tabular-nums">{i + 1}</span>
                        <span className="flex-1 min-w-0 truncate">{item.song?.title || item.song_id}</span>
                        {isLive && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-live text-white">LIVE</span>
                        )}
                        <button
                          type="button"
                          className={`${btnSmall} text-accent-hover`}
                          disabled={isBusy(liveKey)}
                          onClick={() => send('song.live', { song_id: item.song_id }, liveKey)}
                        >
                          Live
                        </button>
                        <button
                          type="button"
                          className={`${btnSmall} text-danger`}
                          disabled={isBusy(removeKey)}
                          onClick={() => send('queue.remove', { queue_item_id: item.id }, removeKey)}
                        >
                          Remove
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search songs…"
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
                    <li key={song.id} className="flex items-center gap-2">
                      <div className="flex-1 min-w-0 py-1">
                        <div className="truncate">{song.title}</div>
                        <div className="text-xs text-ink-mute capitalize">{song.language}</div>
                      </div>
                      <button
                        type="button"
                        className={`${btnSmall} text-accent-hover`}
                        disabled={isBusy(liveKey)}
                        onClick={() => send('song.live', { song_id: song.id }, liveKey)}
                      >
                        Live
                      </button>
                      <button
                        type="button"
                        className={`${btnSmall} text-accent-hover`}
                        disabled={isBusy(addKey)}
                        onClick={() => send('queue.add', { song_id: song.id }, addKey)}
                      >
                        + Queue
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* ===== Bible ===== */}
      {showBible && (
        <section className={card}>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-semibold">Bible</h3>
            <span className="text-sm text-ink-dim">{bibleTarget}</span>
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
              className="flex-1 min-w-0 h-12 px-3 bg-surface-input text-ink border border-edge rounded-lg focus:border-accent focus:outline-none text-base"
            />
            <button
              type="submit"
              className="min-h-12 px-4 rounded-lg bg-accent-deep text-on-accent font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-default"
              disabled={isBusy('bible.send') || !reference.trim()}
            >
              Send
            </button>
          </form>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className={btn}
              disabled={isBusy('bible.step', SCROLL_MAX_IN_FLIGHT)}
              onClick={() => send('bible.step', { dir: -1, send: stepSend })}
            >
              ◀ Prev verse
            </button>
            <button
              type="button"
              className={btn}
              disabled={isBusy('bible.step', SCROLL_MAX_IN_FLIGHT)}
              onClick={() => send('bible.step', { dir: 1, send: stepSend })}
            >
              Next verse ▶
            </button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 min-h-12 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={stepSend}
                onChange={toggleStepSend}
                className="w-5 h-5 accent-current"
              />
              <span className="text-sm">Send on step</span>
            </label>
            <button
              type="button"
              className={btnDanger}
              disabled={isBusy('bible.clear')}
              onClick={() => send('bible.clear')}
            >
              Clear scripture
            </button>
          </div>
          {renderFeedback('bible')}
        </section>
      )}

      {/* ===== Display (only when the control window drives /display) ===== */}
      {capabilities.display && (
        <section className={card}>
          <h3 className="font-semibold">Display</h3>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className={btn}
              disabled={isBusy('scroll', SCROLL_MAX_IN_FLIGHT)}
              onClick={() => send('display.scroll', { dir: -1, amount: 'step' }, 'scroll')}
            >
              Scroll ▲
            </button>
            <button
              type="button"
              className={btn}
              disabled={isBusy('scroll', SCROLL_MAX_IN_FLIGHT)}
              onClick={() => send('display.scroll', { dir: 1, amount: 'step' }, 'scroll')}
            >
              Scroll ▼
            </button>
            <button
              type="button"
              className={btn}
              disabled={isBusy('scroll', SCROLL_MAX_IN_FLIGHT)}
              onClick={() => send('display.scroll', { dir: -1, amount: 'page' }, 'scroll')}
            >
              Page ▲
            </button>
            <button
              type="button"
              className={btn}
              disabled={isBusy('scroll', SCROLL_MAX_IN_FLIGHT)}
              onClick={() => send('display.scroll', { dir: 1, amount: 'page' }, 'scroll')}
            >
              Page ▼
            </button>
            <button
              type="button"
              className={btn}
              disabled={isBusy('zoom', SCROLL_MAX_IN_FLIGHT)}
              onClick={() => send('display.zoom', { delta: -0.1 }, 'zoom')}
            >
              Zoom −
            </button>
            <button
              type="button"
              className={btn}
              disabled={isBusy('zoom', SCROLL_MAX_IN_FLIGHT)}
              onClick={() => send('display.zoom', { delta: 0.1 }, 'zoom')}
            >
              Zoom +
            </button>
          </div>
          {renderFeedback('display')}
        </section>
      )}

      {!capabilities.songs && !showBible && !capabilities.display && (
        <p className="px-3 py-6 text-center text-sm text-ink-mute">This control window offers no remote controls.</p>
      )}
    </div>
  );
}
