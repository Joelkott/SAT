'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { SongsPanelHandle } from '@/components/SongsPanel';
import type { BiblePanelHandle } from '@/components/bible/BiblePanel';
import { isGuest } from '@/lib/role';
import {
  remoteApi,
  getControlId,
  resetControlId,
  newLease,
  httpStatus,
  RemoteCodeInfo,
  RemotePair,
  RemoteCommand,
  RemoteCommandType,
  PanelResult,
} from '@/lib/remote';

// Control-window side of phone remote control: one sequential long-poll loop
// per window that runs phone commands through the existing panel handles and
// acks the result back, plus the pairing state/actions for the PairPanel.

export interface RemoteToast { id: number; text: string; ok: boolean }

export interface RemoteControlState {
  available: boolean; // false until the first successful poll; false again on 404 (old backend)
  online: boolean; // last poll succeeded
  code: RemoteCodeInfo | null;
  pairs: RemotePair[];
  notice: string;
  error: string; // last pairing-action error (e.g. rate limited)
}

export interface UseRemoteControlOptions {
  enabled: boolean; // role is worship | media | admin
  songsRef: RefObject<SongsPanelHandle>;
  bibleRef: RefObject<BiblePanelHandle>;
}

export interface RemoteControl {
  state: RemoteControlState;
  toast: RemoteToast | null;
  requestCode: (rotate?: boolean) => Promise<void>;
  cancelCode: () => Promise<void>;
  unpairPhone: (pairId: number) => Promise<void>;
}

const EXEC_MAX_AGE_MS = 8000;
const COMMAND_CAP_MS = 4500;
const BACKOFF = [1000, 2000, 5000];
const POLL_WAIT_S = 20;
const TOAST_MS = 4000;
const EXEC_KEY = 'sat-remote-executed';
const EXEC_KEEP = 200;

const LABELS: Record<RemoteCommandType, string> = {
  'song.live': 'Send live',
  'song.next': 'Next song',
  'song.prev': 'Previous song',
  'song.clear': 'Clear to black',
  'queue.add': 'Add to queue',
  'queue.remove': 'Remove from queue',
  'bible.send': 'Send verse',
  'bible.step': 'Step verse',
  'bible.clear': 'Clear scripture',
  'display.scroll': 'Scroll',
  'display.zoom': 'Zoom',
};

const INITIAL_STATE: RemoteControlState = {
  available: false,
  online: false,
  code: null,
  pairs: [],
  notice: '',
  error: '',
};

// Resolves after ms, or early when the signal aborts.
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
  });
}

// Races p against a timer so one stuck command can't stall the queue.
function withCap(p: Promise<PanelResult>, ms: number): Promise<PanelResult> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<PanelResult>((resolve) => {
    t = setTimeout(() => resolve({ ok: false, message: 'Took too long' }), ms);
  });
  return Promise.race([p, timer]).finally(() => { if (t) clearTimeout(t); });
}

function loadExecuted(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(EXEC_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').slice(-EXEC_KEEP) : [];
  } catch {
    return [];
  }
}

function saveExecuted(ids: string[]): void {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem(EXEC_KEY, JSON.stringify(ids)); } catch {}
}

export function useRemoteControl(opts: UseRemoteControlOptions): RemoteControl {
  const { enabled, songsRef, bibleRef } = opts;
  const [state, setState] = useState<RemoteControlState>(INITIAL_STATE);
  const [toast, setToast] = useState<RemoteToast | null>(null);
  const controlIdRef = useRef('');
  const leaseRef = useRef('');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ensureIds = useCallback(() => {
    if (!controlIdRef.current) controlIdRef.current = getControlId();
    if (!leaseRef.current) leaseRef.current = newLease();
  }, []);

  const showToast = useCallback((cmd: RemoteCommand, res: PanelResult) => {
    const label = LABELS[cmd.type] || cmd.type;
    setToast({
      id: Date.now(),
      text: `${cmd.from || 'Phone'}: ${label}${res.message ? ' — ' + res.message : ''}`,
      ok: res.ok,
    });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const runCommand = useCallback(async (cmd: RemoteCommand): Promise<PanelResult> => {
    const args = (cmd.args && typeof cmd.args === 'object') ? cmd.args : {};
    const songs = songsRef.current;
    const bible = bibleRef.current;
    switch (cmd.type) {
      case 'song.live':
        if (!songs) return { ok: false, message: 'Not ready' };
        if (!args.song_id) return { ok: false, message: 'Missing song' };
        return songs.sendSongLive(String(args.song_id));
      case 'song.next':
        if (!songs) return { ok: false, message: 'Not ready' };
        return songs.queueStep(1);
      case 'song.prev':
        if (!songs) return { ok: false, message: 'Not ready' };
        return songs.queueStep(-1);
      case 'song.clear':
        if (!songs) return { ok: false, message: 'Not ready' };
        return songs.clearLive();
      case 'queue.add':
        if (!songs) return { ok: false, message: 'Not ready' };
        if (!args.song_id) return { ok: false, message: 'Missing song' };
        return songs.queueAdd(String(args.song_id));
      case 'queue.remove': {
        if (!songs) return { ok: false, message: 'Not ready' };
        const itemId = Number(args.queue_item_id);
        if (!Number.isFinite(itemId)) return { ok: false, message: 'Missing queue item' };
        return songs.queueRemove(itemId);
      }
      case 'bible.send': {
        if (!bible) return { ok: false, message: 'Not ready' };
        const reference = String(args.reference || '').trim();
        if (!reference) return { ok: false, message: 'Missing reference' };
        const target = args.target === 'wall' || args.target === 'display' ? args.target : 'auto';
        return bible.lookupAndSend(reference, target);
      }
      case 'bible.step':
        if (!bible) return { ok: false, message: 'Not ready' };
        return bible.step(args.dir === -1 ? -1 : 1, args.send !== false);
      case 'bible.clear':
        if (!bible) return { ok: false, message: 'Not ready' };
        return bible.clear();
      case 'display.scroll':
        if (!songs) return { ok: false, message: 'Not ready' };
        return songs.scroll(args.dir === -1 ? -1 : 1, args.amount === 'page' ? 'page' : 'step');
      case 'display.zoom':
        if (!songs) return { ok: false, message: 'Not ready' };
        return songs.zoom({
          delta: typeof args.delta === 'number' ? args.delta : undefined,
          value: typeof args.value === 'number' ? args.value : undefined,
        });
      default:
        return { ok: false, message: 'Unknown command' };
    }
  }, [songsRef, bibleRef]);

  // Executor loop: strictly sequential, promise-chained (no polling timer).
  useEffect(() => {
    if (!enabled || isGuest()) return;
    const ac = new AbortController();
    controlIdRef.current = getControlId();
    leaseRef.current = newLease(); // per page load, in memory only

    const executedList = loadExecuted();
    const executed = new Set(executedList);
    const remember = (id: string) => {
      if (executed.has(id)) return;
      executed.add(id);
      executedList.push(id);
      while (executedList.length > EXEC_KEEP) executed.delete(executedList.shift() as string);
      saveExecuted(executedList);
    };

    const run = async () => {
      let fails = 0;
      let lastQueueVersion = -1;
      let republished = false;
      while (!ac.signal.aborted) {
        try {
          const r = await remoteApi.poll(controlIdRef.current, leaseRef.current, POLL_WAIT_S, ac.signal);
          if (ac.signal.aborted) break;
          fails = 0;
          setState((s) => ({
            ...s,
            available: true,
            online: true,
            code: r.code,
            pairs: r.pairs || [],
            notice: r.notice || '',
          }));
          for (const cmd of r.commands || []) { // server returns them in seq order
            if (ac.signal.aborted) break;
            let res: PanelResult;
            if (executed.has(cmd.id)) {
              res = { ok: true, message: 'Already done' };
            } else if (cmd.age_ms > EXEC_MAX_AGE_MS) {
              res = { ok: false, message: 'Expired' };
            } else {
              res = await withCap(runCommand(cmd), COMMAND_CAP_MS)
                .catch((e: any) => ({ ok: false, message: String(e?.message || e) }));
              remember(cmd.id);
              showToast(cmd, res);
            }
            await remoteApi.ack(controlIdRef.current, leaseRef.current, cmd.seq, res.ok, res.message).catch(() => {});
          }
          if (lastQueueVersion !== -1 && r.queue_version !== lastQueueVersion) songsRef.current?.refreshQueue();
          lastQueueVersion = r.queue_version;
          // Backend restarted (live state lost): re-publish our live song once.
          if (r.live_updated_at === 0 && !republished) {
            songsRef.current?.republishLive();
            republished = true;
          }
          if (r.live_updated_at !== 0) republished = false;
        } catch (err) {
          if (ac.signal.aborted) break;
          const st = httpStatus(err);
          if (st === 409) {
            // Duplicated tab: same control id, different lease. Become independent.
            controlIdRef.current = resetControlId();
            setState((s) => ({ ...s, pairs: [], code: null }));
            continue;
          }
          if (st === 404) {
            // Old backend without /remote routes: stay quiet, check again later.
            setState((s) => ({ ...s, available: false, online: false }));
            await sleep(60000, ac.signal);
            continue;
          }
          if (st === 403) {
            setState((s) => ({ ...s, available: false }));
            break;
          }
          setState((s) => ({ ...s, online: false }));
          await sleep(BACKOFF[Math.min(fails++, BACKOFF.length - 1)], ac.signal);
        }
      }
    };
    run();
    return () => ac.abort();
  }, [enabled, runCommand, showToast, songsRef]);

  const requestCode = useCallback(async (rotate = false) => {
    if (isGuest()) return;
    ensureIds();
    try {
      const code = await remoteApi.issueCode(controlIdRef.current, leaseRef.current, rotate);
      setState((s) => ({ ...s, code, error: '', pairs: rotate ? [] : s.pairs }));
    } catch (err: any) {
      if (httpStatus(err) === 429) {
        const retry = Number(err?.response?.data?.retry_after) || 300;
        setState((s) => ({ ...s, error: `Too many wrong attempts — try again in ${Math.ceil(retry / 60)} min` }));
      } else {
        setState((s) => ({ ...s, error: 'Could not create a code' }));
      }
    }
  }, [ensureIds]);

  const cancelCode = useCallback(async () => {
    if (isGuest()) return;
    ensureIds();
    setState((s) => ({ ...s, code: null }));
    await remoteApi.cancelCode(controlIdRef.current, leaseRef.current).catch(() => {});
  }, [ensureIds]);

  const unpairPhone = useCallback(async (pairId: number) => {
    if (isGuest()) return;
    ensureIds();
    try {
      await remoteApi.unpairPhone(controlIdRef.current, leaseRef.current, pairId);
      setState((s) => ({ ...s, pairs: s.pairs.filter((p) => p.id !== pairId), error: '' }));
    } catch {
      setState((s) => ({ ...s, error: 'Could not unpair that phone' }));
    }
  }, [ensureIds]);

  return { state, toast, requestCode, cancelCode, unpairPhone };
}
