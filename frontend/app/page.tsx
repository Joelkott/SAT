'use client';

import { useState, useEffect, useRef } from 'react';
import SongsPanel, { type SongsPanelHandle } from '@/components/SongsPanel';
import BiblePanel, { type BiblePanelHandle } from '@/components/bible/BiblePanel';
import HelpDialog from '@/components/HelpDialog';
import EditLogDialog from '@/components/EditLogDialog';
import DisplaySettingsDialog from '@/components/DisplaySettingsDialog';
import { MusicIcon, BookOpenIcon, MonitorIcon, XIcon, EyeIcon, EyeOffIcon, HelpCircleIcon, SlidersIcon, SmartphoneIcon } from '@/components/icons';
import { useRemoteControl } from '@/components/remote/useRemoteControl';
import PairPanel from '@/components/remote/PairPanel';
import { PAIR_KEY } from '@/lib/remote';
import api from '@/lib/api';
import { getRole, type Role } from '@/lib/role';

type Tab = 'songs' | 'bible';

const TABS: { id: Tab; label: string; Icon: typeof MusicIcon }[] = [
  { id: 'songs', label: 'Songs', Icon: MusicIcon },
  { id: 'bible', label: 'Bible', Icon: BookOpenIcon },
];

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('songs');
  const [authed, setAuthed] = useState(false);
  const [role, setRole] = useState<Role>('');
  const [showPw, setShowPw] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showEditLog, setShowEditLog] = useState(false);
  const [showDisplaySettings, setShowDisplaySettings] = useState(false);
  const [showPair, setShowPair] = useState(false);
  const [songPingActive, setSongPingActive] = useState(false);
  const songsRef = useRef<SongsPanelHandle>(null);
  const bibleRef = useRef<BiblePanelHandle>(null);
  useEffect(() => {
    if (!localStorage.getItem('sat-token')) window.location.href = '/login';
    else { setAuthed(true); setRole(getRole()); }
  }, []);
  // Phone remote control: only team roles that can drive outputs (never guest).
  const remote = useRemoteControl({
    enabled: authed && (role === 'worship' || role === 'media' || role === 'admin'),
    songsRef,
    bibleRef,
  });
  if (!authed) return <div className="min-h-screen bg-surface" />;

  return (
    <div className="min-h-screen bg-surface text-ink">
      {/* App bar */}
      <header className="sticky top-0 z-30 h-14 border-b border-edge bg-surface/85 backdrop-blur-md">
        <div className="h-full px-4 sm:px-6 flex items-center gap-4">
          {/* Brand: JGM logo, tinted via mask so it follows the theme gold */}
          <div
            role="img"
            aria-label="JGM"
            className="h-8 w-[78px] shrink-0 bg-accent"
            style={{
              WebkitMaskImage: 'url(/jgm-logo.png)',
              maskImage: 'url(/jgm-logo.png)',
              WebkitMaskRepeat: 'no-repeat',
              maskRepeat: 'no-repeat',
              WebkitMaskSize: 'contain',
              maskSize: 'contain',
              WebkitMaskPosition: 'left center',
              maskPosition: 'left center',
            }}
          />

          {/* Segmented tab switcher */}
          <div
            role="tablist"
            aria-label="Main sections"
            className="flex items-center gap-0.5 bg-surface-sunken border border-edge rounded-lg p-0.5 ml-2"
          >
            {TABS.map(({ id, label, Icon }) => {
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(id)}
                  className={`flex items-center gap-2 px-4 h-8 rounded-[7px] text-sm font-medium cursor-pointer transition-all duration-150 ${
                    active
                      ? 'bg-surface-hover text-ink shadow-sm border border-edge-strong'
                      : 'text-ink-mute hover:text-ink-dim border border-transparent'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${active ? 'text-accent-hover' : ''}`} />
                  {label}
                  {id === 'songs' && songPingActive && !active && (
                    <span className="w-2 h-2 rounded-full bg-accent animate-pulse" aria-label="New song notification" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex-1" />

          {/* Global actions */}
          {/* Outputs: role-gated (guest is view-only and projects nothing) */}
          {role !== 'guest' && (
            <div className="flex items-center gap-0.5 bg-surface-sunken border border-edge rounded-lg p-0.5">
              {(role === 'worship' || role === 'admin') && (
                <button
                  onClick={() => window.open('/display', '_blank', 'noopener,noreferrer')}
                  title="Open the congregation display window"
                  className="flex items-center gap-2 h-8 px-3 rounded-[7px] text-sm font-medium text-ink-dim hover:text-ink hover:bg-surface-hover cursor-pointer"
                >
                  <MonitorIcon className="w-4 h-4" />
                  <span className="hidden sm:inline">Display</span>
                </button>
              )}
              {(role === 'media' || role === 'admin') && (
                <button
                  onClick={() => window.open('/output/bible', '_blank', 'noopener,noreferrer')}
                  title="Open the Resolume/LED-wall capture page"
                  className="flex items-center gap-2 h-8 px-3 rounded-[7px] text-sm font-medium text-ink-dim hover:text-ink hover:bg-surface-hover cursor-pointer"
                >
                  <BookOpenIcon className="w-4 h-4" />
                  <span className="hidden sm:inline">Resolume</span>
                </button>
              )}
            </div>
          )}

          {/* Help */}
          <button
            onClick={() => setShowHelp(true)}
            title="How to use SAT — shortcuts and tips"
            aria-label="Open help"
            className="h-9 w-9 flex items-center justify-center rounded-lg border border-edge text-ink-dim hover:text-ink hover:border-edge-strong cursor-pointer transition-colors duration-150"
          >
            <HelpCircleIcon className="w-4 h-4" />
          </button>

          {/* Settings: one menu for display settings, phone pairing, admin tools
              and the account (replaces the separate header buttons). */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              title="Settings"
              className="relative flex items-center gap-2 h-9 px-3 rounded-lg border border-edge text-ink-dim hover:text-ink hover:border-edge-strong cursor-pointer text-sm capitalize"
            >
              <SlidersIcon className="w-4 h-4" />
              <span className="hidden sm:inline">{role || 'Settings'}</span>
              {role === 'guest' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-sunken border border-edge text-ink-mute normal-case">View only</span>
              )}
              {remote.state.pairs.length > 0 && (
                <span
                  className="min-w-[18px] h-[18px] px-1 rounded-full bg-accent-deep text-on-accent text-[10px] font-bold flex items-center justify-center tabular-nums"
                  title={`${remote.state.pairs.length} phone(s) paired`}
                >
                  {remote.state.pairs.length}
                </span>
              )}
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 top-11 z-50 w-56 bg-surface-raised border border-edge rounded-xl shadow-2xl p-1.5 fade-swap">
                <div className="px-3 pt-1.5 pb-2 text-xs text-ink-mute">
                  Signed in as <span className="text-ink font-medium capitalize">{role}</span>
                </div>
                {role !== 'guest' && (
                  <>
                    <button
                      role="menuitem"
                      onClick={() => { setShowDisplaySettings(true); setMenuOpen(false); }}
                      className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-sm text-ink-dim hover:text-ink hover:bg-surface-hover cursor-pointer"
                    >
                      <SlidersIcon className="w-4 h-4" />
                      <span className="flex-1">Display settings</span>
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => { setShowPair(true); setMenuOpen(false); }}
                      className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-sm text-ink-dim hover:text-ink hover:bg-surface-hover cursor-pointer"
                    >
                      <SmartphoneIcon className="w-4 h-4" />
                      <span className="flex-1">Pair a phone</span>
                      {remote.state.pairs.length > 0 && (
                        <span className="text-xs text-ink-mute tabular-nums">{remote.state.pairs.length}</span>
                      )}
                    </button>
                  </>
                )}
                {role === 'admin' && (
                  <>
                    <button
                      role="menuitem"
                      onClick={() => { setShowEditLog(true); setMenuOpen(false); }}
                      className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-sm text-ink-dim hover:text-ink hover:bg-surface-hover cursor-pointer"
                    >
                      Edit history
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => { setShowPw(true); setMenuOpen(false); }}
                      className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-sm text-ink-dim hover:text-ink hover:bg-surface-hover cursor-pointer"
                    >
                      Team passwords
                    </button>
                  </>
                )}
                <div className="my-1 border-t border-edge" />
                <button
                  role="menuitem"
                  onClick={() => { localStorage.removeItem('sat-token'); localStorage.removeItem('sat-role'); localStorage.removeItem(PAIR_KEY); window.location.href = '/login'; }}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm text-danger hover:bg-danger/10 cursor-pointer"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Tab content — both stay mounted so switching tabs never loses the
          live song, Bible position, or refetches the translation catalog. */}
      {showPw && <PasswordManager onClose={() => setShowPw(false)} />}
      {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}
      {showEditLog && <EditLogDialog onClose={() => setShowEditLog(false)} />}
      {showDisplaySettings && <DisplaySettingsDialog onClose={() => setShowDisplaySettings(false)} />}
      {showPair && <PairPanel remote={remote} onClose={() => setShowPair(false)} />}

      {/* Remote command feedback (never switches tabs) */}
      {remote.toast && (
        <div
          key={remote.toast.id}
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg border border-edge bg-surface-raised text-sm text-ink shadow-2xl fade-swap"
        >
          <span className={`mr-2 font-semibold ${remote.toast.ok ? 'text-ok' : 'text-danger'}`}>{remote.toast.ok ? '✓' : '✗'}</span>
          {remote.toast.text}
        </div>
      )}

      <div className={activeTab === 'songs' ? '' : 'hidden'}>
        <SongsPanel ref={songsRef} onSongPingChange={setSongPingActive} />
      </div>
      <div className={activeTab === 'bible' ? '' : 'hidden'}>
        <BiblePanel ref={bibleRef} />
      </div>
    </div>
  );
}

function PasswordManager({ onClose }: { onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({ admin: '', media: '', worship: '' });
  const [status, setStatus] = useState<Record<string, string>>({});
  const [show, setShow] = useState<Record<string, boolean>>({});

  const save = async (user: string) => {
    if ((values[user] || '').length < 6) {
      setStatus((s) => ({ ...s, [user]: 'Min 6 characters' }));
      return;
    }
    try {
      await api.put(`/auth/users/${user}/password`, { password: values[user] });
      setStatus((s) => ({ ...s, [user]: 'Updated ✓' }));
      setValues((v) => ({ ...v, [user]: '' }));
    } catch (err: any) {
      setStatus((s) => ({ ...s, [user]: err?.response?.data?.error || 'Failed' }));
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-surface-raised border border-edge rounded-2xl w-full max-w-md p-6 space-y-4 fade-swap">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Team passwords</h2>
          <button onClick={onClose} aria-label="Close" className="p-2 rounded-md text-ink-mute hover:text-ink hover:bg-surface-hover cursor-pointer">
            <XIcon className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-ink-mute">
          Set a new password for any team account. You only need to remember the admin one.
        </p>
        {/* guest has no password (passwordless, view-only) */}
        {(['admin', 'media', 'worship'] as const).map((user) => (
          <div key={user} className="flex items-center gap-2">
            <span className="w-20 text-sm font-medium text-ink-dim capitalize shrink-0">{user}</span>
            <div className="relative flex-1 min-w-0">
              <input
                type={show[user] ? 'text' : 'password'}
                value={values[user]}
                onChange={(e) => setValues((v) => ({ ...v, [user]: e.target.value }))}
                placeholder="New password"
                className="w-full pl-3 pr-9 py-2 bg-surface-input text-ink border border-edge rounded-lg hover:border-edge-strong focus:border-accent focus:outline-none placeholder-ink-mute text-sm"
              />
              <button
                type="button"
                onClick={() => setShow((v) => ({ ...v, [user]: !v[user] }))}
                aria-label={show[user] ? 'Hide password' : 'Show password'}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-ink-mute hover:text-ink cursor-pointer"
              >
                {show[user] ? <EyeOffIcon className="w-3.5 h-3.5" /> : <EyeIcon className="w-3.5 h-3.5" />}
              </button>
            </div>
            <button
              onClick={() => save(user)}
              className="h-9 px-3 rounded-lg bg-accent-deep hover:bg-accent text-on-accent text-sm font-semibold cursor-pointer shrink-0"
            >
              Set
            </button>
            {status[user] && <span className="text-xs text-ink-mute shrink-0">{status[user]}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
