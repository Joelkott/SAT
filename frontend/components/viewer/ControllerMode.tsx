'use client';

import { useEffect, useState } from 'react';
import PairForm from '@/components/viewer/PairForm';
import ControllerPad from '@/components/viewer/ControllerPad';
import {
  remoteApi,
  liveSongApi,
  getPairToken,
  clearPairToken,
  errorCode,
  PairStatus,
  LiveSongState,
} from '@/lib/remote';
import { isGuest } from '@/lib/role';

const STATUS_INTERVAL_MS = 5000;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });

// Phone controller: unpaired → PairForm, paired → status header + ControllerPad.
// Commands are relayed to the paired control window, which runs its own handlers.
export default function ControllerMode() {
  const [ready, setReady] = useState(false);
  const [guest, setGuest] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<PairStatus | null>(null);
  const [notice, setNotice] = useState('');
  const [live, setLive] = useState<LiveSongState | null>(null);

  // ===== Initial state (client only) =====
  useEffect(() => {
    if (isGuest()) {
      // Defence in depth: the page already hides the Controller tab for guests.
      clearPairToken();
      setGuest(true);
    } else {
      setToken(getPairToken());
    }
    setReady(true);
  }, []);

  const handleUnpaired = (message?: string) => {
    clearPairToken();
    setToken(null);
    setStatus(null);
    if (message) setNotice(message);
  };

  // ===== Pair status loop (promise-chained, refetch on visibility) =====
  useEffect(() => {
    if (!token || guest) return;
    let alive = true;
    let ac = new AbortController();
    const loop = async () => {
      while (alive) {
        try {
          const st = await remoteApi.status(token, ac.signal);
          if (!alive) break;
          setStatus(st);
          if (!st.paired) {
            alive = false;
            clearPairToken();
            setToken(null);
            setStatus(null);
            setNotice('This phone was unpaired.');
            break;
          }
        } catch (err: any) {
          if (!alive) break;
          if (errorCode(err) === 'pair_invalid') {
            alive = false;
            clearPairToken();
            setToken(null);
            setStatus(null);
            setNotice('This phone was unpaired.');
            break;
          }
          if (!ac.signal.aborted) {
            setStatus((s) => (s ? { ...s, control_online: false } : s));
          }
        }
        if (ac.signal.aborted) { ac = new AbortController(); continue; }
        await sleep(STATUS_INTERVAL_MS, ac.signal);
        if (ac.signal.aborted && alive) ac = new AbortController();
      }
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') ac.abort();
    };
    document.addEventListener('visibilitychange', onVis);
    loop();
    return () => { alive = false; ac.abort(); document.removeEventListener('visibilitychange', onVis); };
  }, [token, guest]);

  // ===== Live song long-poll (same pattern as ViewerMode) =====
  useEffect(() => {
    if (!token || guest) return;
    let alive = true;
    let ac = new AbortController();
    let since = -1;
    const loop = async () => {
      while (alive) {
        try {
          const st = await liveSongApi.state(since, since === -1 ? 0 : 20, ac.signal);
          since = st.version;
          setLive(st);
        } catch {
          if (!alive) break;
          if (ac.signal.aborted) { ac = new AbortController(); continue; }
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') { since = -1; ac.abort(); }
    };
    document.addEventListener('visibilitychange', onVis);
    loop();
    return () => { alive = false; ac.abort(); document.removeEventListener('visibilitychange', onVis); };
  }, [token, guest]);

  if (!ready || guest) return null;

  if (!token) {
    return (
      <div>
        {notice && (
          <p className="mx-4 mt-4 px-3 py-2 rounded-lg text-sm bg-surface-raised border border-edge text-ink-dim" role="status">
            {notice}
          </p>
        )}
        <PairForm
          onPaired={(r) => {
            setNotice('');
            setToken(r.pair_token);
            setStatus({ paired: true, control_online: true, control_label: r.control_label, capabilities: r.capabilities });
          }}
        />
      </div>
    );
  }

  const online = !!status?.control_online;
  const liveSong = live && !live.cleared ? live.song : null;
  const capabilities = status?.capabilities ?? { songs: true, display: false, wall: false };

  const handleUnpair = () => {
    remoteApi.unpair(token).catch(() => {});
    handleUnpaired();
  };

  return (
    <div className="p-3 space-y-3 max-w-xl mx-auto">
      <div className="bg-surface-raised border border-edge rounded-xl p-3 flex items-center gap-3">
        <span
          className={`shrink-0 w-2.5 h-2.5 rounded-full ${online ? 'bg-ok' : 'bg-ink-mute'}`}
          aria-label={online ? 'Online' : 'Offline'}
        />
        <div className="flex-1 min-w-0">
          <div className="truncate">
            Paired with <strong>{status?.control_label || '…'}</strong> window
          </div>
          <div className="text-xs text-ink-mute">{status ? (online ? 'Online' : 'Offline') : 'Checking…'}</div>
        </div>
        <button
          type="button"
          onClick={handleUnpair}
          className="min-h-10 px-3 rounded-lg text-sm text-ink-dim border border-edge hover:text-ink cursor-pointer"
        >
          Unpair
        </button>
      </div>

      {status && !online && (
        <p className="px-3 py-2 rounded-lg text-sm bg-surface-raised border border-edge text-ink-dim" role="status">
          Control window offline — commands are paused
        </p>
      )}

      <ControllerPad
        token={token}
        capabilities={capabilities}
        disabled={!online}
        liveTitle={liveSong?.title}
        liveSongId={liveSong?.id}
        queueVersion={live?.queue_version}
        onUnpaired={() => handleUnpaired('This phone was unpaired.')}
      />
    </div>
  );
}
