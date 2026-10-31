'use client';

import { useEffect, useState } from 'react';
import ViewerMode from '@/components/viewer/ViewerMode';
import ControllerMode from '@/components/viewer/ControllerMode';
import { getRole, isGuest, Role } from '@/lib/role';
import { PAIR_KEY } from '@/lib/remote';
import { useWakeLock } from '@/lib/useWakeLock';

type Mode = 'viewer' | 'controller';

const MODE_KEY = 'sat-viewer-mode';

export default function ViewerPage() {
  const [authed, setAuthed] = useState(false);
  const [role, setRole] = useState<Role>('');
  const [mode, setMode] = useState<Mode>('viewer');
  const { supported: wakeLockSupported } = useWakeLock(true);

  // Auth guard (return here after sign-in) + guest rule: viewer only, no pair session.
  useEffect(() => {
    if (!localStorage.getItem('sat-token')) {
      window.location.href = '/login?next=/viewer';
      return;
    }
    setRole(getRole());
    if (isGuest()) {
      localStorage.removeItem(PAIR_KEY);
      setMode('viewer');
    } else {
      const stored = localStorage.getItem(MODE_KEY);
      setMode(stored === 'controller' ? 'controller' : 'viewer');
    }
    setAuthed(true);
  }, []);

  const guest = role === 'guest';

  const handleMode = (m: Mode) => {
    if (m === 'controller' && isGuest()) return;
    setMode(m);
    localStorage.setItem(MODE_KEY, m);
  };

  const handleSignOut = () => {
    localStorage.removeItem('sat-token');
    localStorage.removeItem('sat-role');
    localStorage.removeItem(PAIR_KEY);
    window.location.href = '/login?next=/viewer';
  };

  if (!authed) {
    return <div className="min-h-[100dvh] bg-black" />;
  }

  const segBtn = (active: boolean) =>
    `px-3 h-8 rounded-md text-sm font-medium cursor-pointer ${
      active ? 'bg-accent-deep text-on-accent' : 'text-ink-dim hover:text-ink'
    }`;

  return (
    <div
      className="min-h-[100dvh] bg-black text-ink overflow-x-clip"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div
        className="sticky z-30 h-12 px-3 flex items-center justify-between gap-2 bg-black/95 border-b border-edge"
        style={{ top: 'env(safe-area-inset-top)' }}
      >
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-surface-sunken border border-edge">
          <button type="button" className={segBtn(mode === 'viewer' || guest)} onClick={() => handleMode('viewer')}>
            Viewer
          </button>
          {!guest && (
            <button type="button" className={segBtn(mode === 'controller')} onClick={() => handleMode('controller')}>
              Controller
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 min-w-0">
          {role && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-surface-raised border border-edge text-ink-dim truncate">
              {guest ? 'View only' : role}
            </span>
          )}
          <button type="button" onClick={handleSignOut} className="text-xs text-ink-mute hover:text-ink cursor-pointer">
            Sign out
          </button>
        </div>
      </div>

      {mode === 'controller' && !guest ? (
        <ControllerMode />
      ) : (
        <ViewerMode readOnly={guest} wakeLockSupported={wakeLockSupported} />
      )}
    </div>
  );
}
