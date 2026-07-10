'use client';

import { useState, useEffect } from 'react';
import SongsPanel from '@/components/SongsPanel';
import BiblePanel from '@/components/bible/BiblePanel';
import { MusicIcon, BookOpenIcon, MonitorIcon } from '@/components/icons';

type Tab = 'songs' | 'bible';

const TABS: { id: Tab; label: string; Icon: typeof MusicIcon }[] = [
  { id: 'songs', label: 'Songs', Icon: MusicIcon },
  { id: 'bible', label: 'Bible', Icon: BookOpenIcon },
];

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('songs');
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    if (!localStorage.getItem('sat-token')) window.location.href = '/login';
    else setAuthed(true);
  }, []);
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
                </button>
              );
            })}
          </div>

          <div className="flex-1" />

          {/* Global actions */}
          <button
            onClick={() => window.open('/output/bible', '_blank', 'noopener,noreferrer')}
            title="Open the Resolume/LED-wall capture page (/output/bible)"
            className="flex items-center gap-2 h-9 px-3.5 rounded-lg border border-edge text-ink-dim hover:text-ink hover:border-accent hover:bg-accent/10 cursor-pointer transition-colors duration-150 text-sm font-medium shrink-0"
          >
            <BookOpenIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Resolume</span>
          </button>
          <button
            onClick={() => { localStorage.removeItem('sat-token'); localStorage.removeItem('sat-role'); window.location.href = '/login'; }}
            title="Sign out"
            className="h-9 px-3 rounded-lg text-ink-mute hover:text-danger cursor-pointer text-sm"
          >
            Sign out
          </button>
          <button
            onClick={() => window.open('/display', '_blank', 'noopener,noreferrer')}
            title="Open the congregation display window"
            className="flex items-center gap-2 h-9 px-3.5 rounded-lg border border-edge text-ink-dim hover:text-ink hover:border-accent hover:bg-accent/10 cursor-pointer transition-colors duration-150 text-sm font-medium shrink-0"
          >
            <MonitorIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Display</span>
          </button>
        </div>
      </header>

      {/* Tab content — both stay mounted so switching tabs never loses the
          live song, Bible position, or refetches the translation catalog. */}
      <div className={activeTab === 'songs' ? '' : 'hidden'}>
        <SongsPanel />
      </div>
      <div className={activeTab === 'bible' ? '' : 'hidden'}>
        <BiblePanel />
      </div>
    </div>
  );
}
