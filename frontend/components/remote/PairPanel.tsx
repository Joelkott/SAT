'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { XIcon, SmartphoneIcon } from '@/components/icons';
import type { RemoteControl } from '@/components/remote/useRemoteControl';

interface PairPanelProps {
  remote: RemoteControl;
  onClose: () => void;
}

function formatCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// expires_at may arrive as unix seconds or milliseconds; normalise to ms.
function expiresAtMs(v: number): number {
  return v < 1e12 ? v * 1000 : v;
}

export default function PairPanel({ remote, onClose }: PairPanelProps) {
  const { state, requestCode, cancelCode, unpairPhone } = remote;
  const [now, setNow] = useState(() => Date.now());
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [justPaired, setJustPaired] = useState(false);
  const [origin, setOrigin] = useState('');
  const requestedRef = useRef(false);
  const shownCodeRef = useRef<string | null>(null);
  const pairsAtCodeRef = useRef(0);

  // Ask for a code once when the panel opens (guarded against StrictMode re-run).
  useEffect(() => {
    setOrigin(window.location.origin);
    if (requestedRef.current) return;
    requestedRef.current = true;
    if (!state.code) requestCode(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 1 s tick for the countdown (UI only).
  useEffect(() => {
    const t = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(t);
  }, [now]);

  // Detect "code consumed by a phone": code disappears and the pair count grew.
  useEffect(() => {
    if (state.code) {
      if (shownCodeRef.current !== state.code.code) {
        shownCodeRef.current = state.code.code;
        pairsAtCodeRef.current = state.pairs.length;
        setJustPaired(false);
      }
    } else if (shownCodeRef.current && state.pairs.length > pairsAtCodeRef.current) {
      shownCodeRef.current = null;
      setJustPaired(true);
    }
  }, [state.code, state.pairs.length]);

  const handleClose = useCallback(() => {
    // An unused code should not linger once the operator closes the panel.
    cancelCode();
    onClose();
  }, [cancelCode, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleClose]);

  const handleNewCode = () => {
    setJustPaired(false);
    setConfirmRotate(false);
    requestCode(false);
  };

  const handleRotate = () => {
    setJustPaired(false);
    setConfirmRotate(false);
    requestCode(true);
  };

  const code = state.code;
  const remaining = code ? expiresAtMs(code.expires_at) - now : 0;
  const expired = !!code && remaining <= 0;
  const n = state.pairs.length;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
      onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pair-panel-title"
        className="bg-surface-raised border border-edge rounded-2xl w-full max-w-sm p-6 space-y-4 fade-swap"
      >
        <div className="flex items-center justify-between">
          <h2 id="pair-panel-title" className="text-lg font-semibold text-ink flex items-center gap-2">
            <SmartphoneIcon className="w-5 h-5 text-accent-hover" />
            Pair a phone
          </h2>
          <button onClick={handleClose} aria-label="Close" className="p-2 rounded-md text-ink-mute hover:text-ink hover:bg-surface-hover cursor-pointer">
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-ink-mute">
          On the phone, open <span className="text-ink-dim font-medium break-all">{origin}/viewer</span>, sign in with a team account and enter this code.
        </p>

        {/* Code / paired state */}
        <div className="rounded-xl bg-surface-sunken border border-edge py-5 px-4 text-center">
          {justPaired && !code ? (
            <div className="space-y-3">
              <p className="text-ok font-semibold">Phone paired ✓</p>
              <button
                onClick={handleNewCode}
                className="h-9 px-3 rounded-lg bg-accent-deep hover:bg-accent text-on-accent text-sm font-semibold cursor-pointer"
              >
                Pair another phone
              </button>
            </div>
          ) : code && !expired ? (
            <>
              <div className="text-4xl font-bold tabular-nums tracking-[0.2em] text-ink">{formatCode(code.code)}</div>
              <div className="mt-2 text-xs text-ink-mute tabular-nums">expires {formatRemaining(remaining)}</div>
            </>
          ) : code && expired ? (
            <div className="space-y-3">
              <p className="text-sm text-ink-dim">Code expired</p>
              <button
                onClick={handleNewCode}
                className="h-9 px-3 rounded-lg bg-accent-deep hover:bg-accent text-on-accent text-sm font-semibold cursor-pointer"
              >
                New code
              </button>
            </div>
          ) : (
            <p className="text-sm text-ink-mute">{state.error ? 'No code' : 'Creating a code…'}</p>
          )}
        </div>

        {!state.online && (
          <p className="text-xs text-warn">Control window offline — reconnecting…</p>
        )}
        {state.notice && <p className="text-xs text-warn">{state.notice}</p>}
        {state.error && <p className="text-xs text-danger">{state.error}</p>}

        {/* Paired phones */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink-dim">
            {n} phone{n === 1 ? '' : 's'} paired
          </p>
          {n > 0 && (
            <ul className="space-y-1.5 max-h-48 overflow-y-auto">
              {state.pairs.map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-lg border border-edge px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-ink truncate">{p.label || 'Phone'}</div>
                    <div className="text-[11px] text-ink-mute truncate">
                      {p.username} · {p.created_at ? new Date(p.created_at).toLocaleString() : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => unpairPhone(p.id)}
                    className="h-8 px-2.5 rounded-md border border-edge text-xs text-danger hover:bg-danger/10 cursor-pointer shrink-0"
                  >
                    Unpair
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        {confirmRotate ? (
          <div className="rounded-lg border border-edge-strong p-3 space-y-2">
            <p className="text-sm text-ink-dim">Unpair every phone and issue a new code?</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmRotate(false)}
                className="h-8 px-3 rounded-md border border-edge text-sm text-ink-dim hover:text-ink cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleRotate}
                className="h-8 px-3 rounded-md bg-danger/15 border border-danger/40 text-sm text-danger hover:bg-danger/25 cursor-pointer"
              >
                Confirm
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2 justify-between">
            <button
              onClick={handleNewCode}
              className="h-9 px-3 rounded-lg border border-edge text-sm text-ink-dim hover:text-ink hover:border-edge-strong cursor-pointer"
            >
              New code
            </button>
            <button
              onClick={() => setConfirmRotate(true)}
              className="h-9 px-3 rounded-lg border border-edge text-sm text-danger hover:bg-danger/10 cursor-pointer"
            >
              Rotate (unpair all)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
