'use client';

import { ReactNode, useEffect, useState } from 'react';
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
export default function ControllerMode({ settingsButton }: { settingsButton: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [guest, setGuest] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<PairStatus | null>(null);
  const [notice, setNotice] = useState('');
  const [live, setLive] = useState<LiveSongState | null>(null);
  const [showPairInfo, setShowPairInfo] = useState(false);

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

  // Slim top bar; when paired it carries a small status chip that opens the
  // pairing details (instead of a big card in the page).
  const header = (chip?: ReactNode) => (
    <div
      className="sticky z-30 h-11 px-4 flex items-center gap-2 bg-black/95 border-b border-edge"
      style={{ top: 'env(safe-area-inset-top)' }}
    >
      <span className="font-semibold">Controller</span>
      <span className="flex-1" />
      {chip}
      {settingsButton}
    </div>
  );

  if (!token) {
    return (
      <div>
        {header()}
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

  const chip = (
    <button
      type="button"
      onClick={() => setShowPairInfo(true)}
      aria-label={`Paired with the ${status?.control_label || ''} window, ${online ? 'online' : 'offline'}. Pairing options`}
      className="shrink-0 h-8 max-w-[45vw] px-2.5 flex items-center gap-1.5 rounded-full border border-edge bg-surface-raised text-xs text-ink-dim cursor-pointer"
    >
      <span className={`shrink-0 w-2 h-2 rounded-full ${online ? 'bg-ok' : 'bg-ink-mute'}`} />
      <span className="truncate capitalize">{status?.control_label || '…'}</span>
    </button>
  );

  return (
    <div>
      {header(chip)}
      {status && !online && (
        <div className="bg-warn/15 text-warn text-xs px-4 py-1 text-center" role="status">
          Control window offline — commands are paused
        </div>
      )}
      <div className="p-3 max-w-xl mx-auto">
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

      {showPairInfo && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="pair-info-title">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowPairInfo(false)} />
          <div
            className="fixed inset-x-0 bottom-0 rounded-t-2xl bg-surface-raised border-t border-edge p-4 space-y-4"
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
          >
            <div className="flex items-center gap-3">
              <span className={`shrink-0 w-2.5 h-2.5 rounded-full ${online ? 'bg-ok' : 'bg-ink-mute'}`} />
              <div className="flex-1 min-w-0">
                <h2 id="pair-info-title" className="font-semibold truncate">
                  Paired with the <span className="capitalize">{status?.control_label || '…'}</span> window
                </h2>
                <p className="text-xs text-ink-mute">{status ? (online ? 'Online' : 'Offline — commands are paused') : 'Checking…'}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowPairInfo(false)}
                className="flex-1 min-h-12 rounded-xl border border-edge text-ink-dim font-semibold cursor-pointer"
              >
                Done
              </button>
              <button
                type="button"
                onClick={() => { setShowPairInfo(false); handleUnpair(); }}
                className="flex-1 min-h-12 rounded-xl border border-danger/60 bg-danger/15 text-danger font-semibold cursor-pointer"
              >
                Unpair
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
