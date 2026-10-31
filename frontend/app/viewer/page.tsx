'use client';

import { useEffect, useState } from 'react';
import ViewerMode from '@/components/viewer/ViewerMode';
import ControllerMode from '@/components/viewer/ControllerMode';
import SettingsSheet from '@/components/viewer/SettingsSheet';
import { SlidersIcon } from '@/components/icons';
import { getRole, isGuest, Role } from '@/lib/role';
import { PAIR_KEY } from '@/lib/remote';
import { useWakeLock } from '@/lib/useWakeLock';

type Mode = 'viewer' | 'controller';

const MODE_KEY = 'sat-viewer-mode';
const FONT_KEY = 'sat-viewer-font';
const FONT_DEFAULT = 22;
const FONT_MIN = 14;
const FONT_MAX = 40;
const FONT_STEP = 2;

const clampFont = (n: number) => Math.min(FONT_MAX, Math.max(FONT_MIN, n));

export default function ViewerPage() {
  const [authed, setAuthed] = useState(false);
  const [role, setRole] = useState<Role>('');
  const [mode, setMode] = useState<Mode>('viewer');
  const [showSettings, setShowSettings] = useState(false);
  const [fontSize, setFontSize] = useState(FONT_DEFAULT);
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
    const storedFont = Number(localStorage.getItem(FONT_KEY));
    if (storedFont) setFontSize(clampFont(storedFont));
    setAuthed(true);
  }, []);

  const handleFont = (dir: number) => {
    setFontSize((f) => {
      const next = clampFont(f + dir * FONT_STEP);
      try { localStorage.setItem(FONT_KEY, String(next)); } catch {}
      return next;
    });
  };

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

  const settingsButton = (
    <button
      type="button"
      onClick={() => setShowSettings(true)}
      aria-label="Settings"
      className="shrink-0 w-10 h-10 -mr-2 flex items-center justify-center rounded-lg text-ink-dim hover:text-ink cursor-pointer"
    >
      <SlidersIcon className="w-5 h-5" />
    </button>
  );

  return (
    <div
      className="min-h-[100dvh] bg-black text-ink overflow-x-clip"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {mode === 'controller' && !guest ? (
        <ControllerMode settingsButton={settingsButton} />
      ) : (
        <ViewerMode readOnly={guest} fontSize={fontSize} settingsButton={settingsButton} />
      )}

      <SettingsSheet
        open={showSettings}
        onClose={() => setShowSettings(false)}
        mode={guest ? 'viewer' : mode}
        onMode={(m) => { handleMode(m); setShowSettings(false); }}
        guest={guest}
        role={role}
        fontSize={fontSize}
        fontMin={FONT_MIN}
        fontMax={FONT_MAX}
        onFont={handleFont}
        wakeLockSupported={wakeLockSupported}
        onSignOut={handleSignOut}
      />
    </div>
  );
}
