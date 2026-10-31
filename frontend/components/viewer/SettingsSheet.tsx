'use client';

type Mode = 'viewer' | 'controller';

interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
  mode: Mode;
  onMode: (m: Mode) => void;
  guest: boolean;
  role: string;
  fontSize: number;
  fontMin: number;
  fontMax: number;
  onFont: (delta: number) => void;
  wakeLockSupported: boolean;
  onSignOut: () => void;
}

// Everything that isn't lyrics or song navigation lives here, so the viewer
// can give the screen to the lyrics.
export default function SettingsSheet({
  open, onClose, mode, onMode, guest, role, fontSize, fontMin, fontMax, onFont, wakeLockSupported, onSignOut,
}: SettingsSheetProps) {
  if (!open) return null;

  const segBtn = (active: boolean) =>
    `flex-1 min-h-11 rounded-md text-sm font-medium cursor-pointer ${
      active ? 'bg-accent-deep text-on-accent' : 'text-ink-dim hover:text-ink'
    }`;
  const sizeBtn =
    'w-14 min-h-11 rounded-lg bg-surface-input border border-edge text-ink font-semibold cursor-pointer disabled:opacity-40';

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="viewer-settings-title">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="fixed inset-x-0 bottom-0 rounded-t-2xl bg-surface-raised border-t border-edge"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center justify-between px-4 h-12 border-b border-edge">
          <span id="viewer-settings-title" className="font-semibold">Settings</span>
          <button type="button" onClick={onClose} className="min-h-12 px-3 text-sm text-ink-dim hover:text-ink cursor-pointer">
            Done
          </button>
        </div>

        <div className="p-4 space-y-5">
          {!guest && (
            <div>
              <div className="text-xs font-semibold text-ink-mute uppercase tracking-wider mb-2">Mode</div>
              <div className="flex gap-1 p-1 rounded-lg bg-surface-sunken border border-edge">
                <button type="button" className={segBtn(mode === 'viewer')} onClick={() => onMode('viewer')} aria-pressed={mode === 'viewer'}>
                  Viewer
                </button>
                <button type="button" className={segBtn(mode === 'controller')} onClick={() => onMode('controller')} aria-pressed={mode === 'controller'}>
                  Controller
                </button>
              </div>
            </div>
          )}

          <div>
            <div className="text-xs font-semibold text-ink-mute uppercase tracking-wider mb-2">Lyrics size</div>
            <div className="flex items-center gap-3">
              <button type="button" className={sizeBtn} onClick={() => onFont(-1)} disabled={fontSize <= fontMin} aria-label="Smaller text">
                A−
              </button>
              <span className="flex-1 text-center text-sm text-ink-dim tabular-nums">{fontSize}px</span>
              <button type="button" className={sizeBtn} onClick={() => onFont(1)} disabled={fontSize >= fontMax} aria-label="Larger text">
                A+
              </button>
            </div>
          </div>

          {!wakeLockSupported && (
            <p className="text-xs text-ink-mute">Keep-screen-on isn&apos;t available in this browser.</p>
          )}

          <div className="flex items-center justify-between gap-3 pt-4 border-t border-edge">
            <div className="min-w-0 text-sm text-ink-dim truncate">
              Signed in as <span className="text-ink font-medium">{guest ? 'guest (view only)' : role}</span>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              className="shrink-0 min-h-11 px-4 rounded-lg border border-edge text-sm text-ink-dim hover:text-danger hover:border-danger/50 cursor-pointer"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
